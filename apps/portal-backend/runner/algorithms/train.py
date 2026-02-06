import os
import json
import time
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.distributions.categorical import Categorical
from collections import deque

# PettingZoo & Supersuit
from pettingzoo.mpe import simple_tag_v3
import supersuit as ss

class SharedAgent(nn.Module):
    def __init__(self, obs_shape, action_shape):
        super().__init__()
        # Flatten observation if it's an image, though MPE is vector
        self.obs_dim = np.prod(obs_shape)
        self.act_dim = action_shape.n
        
        # Shared Feature Extractor
        self.base = nn.Sequential(
            nn.Linear(self.obs_dim, 128),
            nn.Tanh(),
            nn.Linear(128, 128),
            nn.Tanh(),
        )
        
        # Actor Head
        self.actor = nn.Linear(128, self.act_dim)
        
        # Critic Head (Centralized training via Parameter Sharing)
        self.critic = nn.Linear(128, 1)

    def get_value(self, x):
        return self.critic(self.base(x))

    def get_action_and_value(self, x, action=None):
        hidden = self.base(x)
        logits = self.actor(hidden)
        probs = Categorical(logits=logits)
        
        if action is None:
            action = probs.sample()
            
        return action, probs.log_prob(action), probs.entropy(), self.critic(hidden)

def train(config, metrics_path, checkpoint_dir, run_id, env=None, env_config=None):
    """
    MAPPO Entrypoint for PettingZoo simple_tag_v3.
    """
    # 1. Hyperparameters
    train_config = config.get("train", {})
    lr = train_config.get("lr", 1e-3)
    total_steps = train_config.get("total_steps", 50000)
    
    # PPO Specific Params
    gamma = 0.99
    gae_lambda = 0.95
    clip_coef = 0.2
    ent_coef = 0.01
    vf_coef = 0.5
    max_grad_norm = 0.5
    batch_size = 2048  # Total transitions per update
    minibatch_size = 256
    update_epochs = 4
    
    # Device
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Running on device: {device}")

    # 2. Environment Setup
    if env is None:
        # Constraint: Wolfpack Scenario (5 Slow Predators vs 1 Fast Prey)
        # Note: 'slow' and 'fast' are internal defaults of simple_tag_v3, 
        # we control numbers here.
        env = simple_tag_v3.parallel_env(
            num_good=1, 
            num_adversaries=5, 
            num_obstacles=2, 
            max_cycles=100, 
            continuous_actions=False
        )

    # 3. Feature Processing (Supersuit)
    # Pad observations to handle different observation spaces (Adversary vs Good)
    env = ss.pad_observations_v0(env)
    env = ss.pad_action_space_v0(env)
    
    # Vectorize: This flattens the Multi-Agent env into a "vector" of agents
    # allowing us to treat it like a batch of independent agents sharing a policy.
    # We use 1 parallel env, but concat agents into the batch dim.
    env = ss.pettingzoo_env_to_vec_env_v1(env)
    env = ss.concat_vec_envs_v1(env, num_vec_envs=1, num_cpus=1, base_class='gym')

    # 4. Agent Setup
    # Supersuit vector envs expose single agent shape
    obs_shape = env.observation_space.shape
    action_shape = env.action_space
    
    agent = SharedAgent(obs_shape, action_shape).to(device)
    optimizer = optim.Adam(agent.parameters(), lr=lr, eps=1e-5)

    # 5. Storage
    # Calculate number of steps per rollout based on batch size
    # We treat all agents as a batch.
    num_agents = env.num_envs
    num_steps = batch_size // num_agents
    
    obs = torch.zeros((num_steps, num_agents) + obs_shape).to(device)
    actions = torch.zeros((num_steps, num_agents)).to(device)
    logprobs = torch.zeros((num_steps, num_agents)).to(device)
    rewards = torch.zeros((num_steps, num_agents)).to(device)
    dones = torch.zeros((num_steps, num_agents)).to(device)
    values = torch.zeros((num_steps, num_agents)).to(device)

    # Tracking
    global_step = 0
    start_time = time.time()
    
    # "Win Rate" tracking: Collision in last 100 steps
    # In simple_tag, collision reward is +10 for adversary. 
    # We define a "win" (catch) step if any adversary gets a large positive reward.
    recent_catches = deque(maxlen=100) 
    
    # Initialize Env
    next_obs = torch.Tensor(env.reset()).to(device)
    next_done = torch.zeros(num_agents).to(device)

    # 6. Main Training Loop
    while global_step < total_steps:
        
        # --- Rollout Phase ---
        for step in range(num_steps):
            global_step += num_agents
            obs[step] = next_obs
            dones[step] = next_done

            with torch.no_grad():
                action, logprob, _, value = agent.get_action_and_value(next_obs)
                values[step] = value.flatten()
            
            actions[step] = action
            logprobs[step] = logprob

            # Step Env
            next_obs_numpy, reward_numpy, done_numpy, info_list = env.step(action.cpu().numpy())
            rewards[step] = torch.tensor(reward_numpy).to(device).view(-1)
            next_obs = torch.Tensor(next_obs_numpy).to(device)
            next_done = torch.Tensor(done_numpy).to(device)

            # --- Metric Calculation (Win Rate) ---
            # Check if any agent (specifically adversaries) got a collision reward.
            # In simple_tag, collision = +10. We check > 5 to be safe.
            # The env vector flattens everyone, so we look at the batch.
            # Usually agents 0-4 are adversaries, 5 is good.
            # But supersuit might shuffle. Info is reliable or reward magnitude.
            has_collision = (rewards[step] > 5.0).any().item()
            recent_catches.append(1.0 if has_collision else 0.0)

            # Logging trigger
            if (global_step // num_agents) % 1000 == 0:
                # Calculate metrics
                win_rate = sum(recent_catches) / len(recent_catches) if len(recent_catches) > 0 else 0.0
                return_mean = rewards.mean().item() # Mean reward of current batch chunk
                
                log_data = {
                    "step": global_step,
                    "values": {
                        "winRate": win_rate,
                        "returnMean": return_mean
                    }
                }
                
                with open(metrics_path, "a") as f:
                    f.write(json.dumps(log_data) + "\n")
                
                print(f"Step: {global_step} | WinRate: {win_rate:.2f} | Return: {return_mean:.4f}")

            if global_step >= total_steps:
                break

        # --- GAE Calculation ---
        with torch.no_grad():
            next_value = agent.get_value(next_obs).reshape(1, -1)
            advantages = torch.zeros_like(rewards).to(device)
            lastgaelam = 0
            for t in reversed(range(num_steps)):
                if t == num_steps - 1:
                    nextnonterminal = 1.0 - next_done
                    nextvalues = next_value
                else:
                    nextnonterminal = 1.0 - dones[t + 1]
                    nextvalues = values[t + 1]
                
                delta = rewards[t] + gamma * nextvalues.flatten() * nextnonterminal - values[t]
                advantages[t] = lastgaelam = delta + gamma * gae_lambda * nextnonterminal * lastgaelam
            
            returns = advantages + values

        # --- PPO Update Phase ---
        b_obs = obs.reshape((-1,) + obs_shape)
        b_logprobs = logprobs.reshape(-1)
        b_actions = actions.reshape(-1)
        b_advantages = advantages.reshape(-1)
        b_returns = returns.reshape(-1)
        b_values = values.reshape(-1)

        # Flatten the batch
        b_inds = np.arange(batch_size)
        
        for epoch in range(update_epochs):
            np.random.shuffle(b_inds)
            for start in range(0, batch_size, minibatch_size):
                end = start + minibatch_size
                mb_inds = b_inds[start:end]

                _, newlogprob, entropy, newvalue = agent.get_action_and_value(
                    b_obs[mb_inds], b_actions.long()[mb_inds]
                )
                
                logratio = newlogprob - b_logprobs[mb_inds]
                ratio = logratio.exp()

                with torch.no_grad():
                    # Calculate approx_kl http://joschu.net/blog/kl-approx.html
                    # old_approx_kl = (-logratio).mean()
                    approx_kl = ((ratio - 1) - logratio).mean()

                mb_advantages = b_advantages[mb_inds]
                # Normalize advantages
                mb_advantages = (mb_advantages - mb_advantages.mean()) / (mb_advantages.std() + 1e-8)

                # Policy Loss
                pg_loss1 = -mb_advantages * ratio
                pg_loss2 = -mb_advantages * torch.clamp(ratio, 1 - clip_coef, 1 + clip_coef)
                pg_loss = torch.max(pg_loss1, pg_loss2).mean()

                # Value Loss
                newvalue = newvalue.view(-1)
                v_loss_unclipped = (newvalue - b_returns[mb_inds]) ** 2
                v_clipped = b_values[mb_inds] + torch.clamp(
                    newvalue - b_values[mb_inds],
                    -clip_coef,
                    clip_coef,
                )
                v_loss_clipped = (v_clipped - b_returns[mb_inds]) ** 2
                v_loss_max = torch.max(v_loss_unclipped, v_loss_clipped)
                v_loss = 0.5 * v_loss_max.mean()

                # Total Loss
                entropy_loss = entropy.mean()
                loss = pg_loss - ent_coef * entropy_loss + vf_coef * v_loss

                optimizer.zero_grad()
                loss.backward()
                nn.utils.clip_grad_norm_(agent.parameters(), max_grad_norm)
                optimizer.step()

    env.close()
    print("Training Complete.")