import httpx
from typing import List, Dict, Any
from sqlalchemy.orm import Session
from app.db import models
import logging

logger = logging.getLogger(__name__)

def dispatch_webhooks(db: Session, event: str, payload: Dict[str, Any]) -> None:
    """
    Finds all active webhooks subscribed to the given event and sends the payload via POST.
    """
    try:
        # Simple string matching for now (e.g., event="job.finished")
        webhooks = db.query(models.Webhook).filter(
            models.Webhook.active == True,
            models.Webhook.events.contains([event])
        ).all()
        
        if not webhooks:
            return

        # In a real system, this should be async (Celery/RQ).
        # For now, we do it inline with a short timeout to avoid blocking too long.
        with httpx.Client(timeout=2.0) as client:
            for wh in webhooks:
                try:
                    # Construct payload
                    body = {
                        "event": event,
                        "data": payload,
                        "timestamp": payload.get("timestamp")
                    }
                    headers = {"Content-Type": "application/json"}
                    if wh.secret:
                        headers["X-Webhook-Secret"] = wh.secret
                        
                    client.post(wh.url, json=body, headers=headers)
                except Exception as exc:
                    logger.warning(f"Failed to dispatch webhook to {wh.url}: {exc}")
                    
    except Exception as exc:
        logger.error(f"Error in webhook dispatch: {exc}")

def send_dynamic_webhook(webhook_url: str, payload: Dict[str, Any]) -> None:
    """
    Sends a POST request to a dynamically provided webhook_url.
    Used for Orchestrator delegation callbacks.
    """
    if not webhook_url:
        return
    try:
        with httpx.Client(timeout=5.0) as client:
            client.post(webhook_url, json=payload)
    except Exception as exc:
        logger.warning(f"Failed to send dynamic webhook to {webhook_url}: {exc}")
