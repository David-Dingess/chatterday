"""Mini golf, holes 4 to 6: on along the path from holes 1 to 3, a pond in the corner. The path goes on to
holes 7 to 9 at the left edge.

Drawn by scripts/basement/_golf_art.py (all three scenes; the holes from client/src/basement/golf-courses.json). The
page is client/src/basement/minigolf.tsx, the game server/basement/minigolf.ts."""
import importlib.util as _iu
import os as _os

_s = _iu.spec_from_file_location('golf_art', _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), '_golf_art.py'))
art = _iu.module_from_spec(_s)
_s.loader.exec_module(art)

TITLE = 'Mini golf, holes 4 to 6'
BLURB = 'Nine holes, up the path from the backyard'
ORDER = 1002
SHELL = False
VIGNETTE = 0.12
GROUND = art.GROUND
EXIT = art.EXITS['minigolf2']
EXTRA = {}
SEASONS = ('spring', 'fall', 'winter', 'snow')  # drawn once a season as well (scripts/basement/_seasons.py; summer is base.png)


def draw(mc, L):
    art.scene(mc, L, 'minigolf2')
