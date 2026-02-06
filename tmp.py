import orekit
orekit.initVM()
from org.orekit.data import DataProvidersManager, DirectoryCrawler
from java.io import File
data_path = "/home/dwj/rl-research-platform/.local/orbitzoo/orekit-data/orekit-data-main"
mgr = DataProvidersManager.getDefault()
mgr.addProvider(DirectoryCrawler(File(data_path)))
from org.orekit.frames import FramesFactory
from org.orekit.utils import IERSConventions
FramesFactory.getITRF(IERSConventions.IERS_2010, True)
print("Orekit OK")