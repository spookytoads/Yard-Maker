# Yard Maker

Turn a [Polycam](https://poly.cam) scan of your yard into a measured site plan, then get
suggestions for where your furniture should go so you keep the most open lawn.

It runs entirely in the browser. Your scan never leaves your device.

## What it does

- **Measures the yard from the scan.** It finds the overall size, usable ground, slope,
  and how much of the yard is shaded by tree canopy.
- **Finds what is already there.** Trees, sheds, the house wall, fences, tables and grills
  are detected from their height and shape. You can rename any of them and mark each one
  *Fixed* (trees, sheds) or *Movable* (a table, a grill).
- **Lets you correct the scan.**
  - *Mark an item:* drag a box on the plan around something the scan missed. Whatever stands up
    inside the box becomes the item, measured from the scan; if nothing does (a low bench read as
    ground), the box itself is used.
  - *Split:* mark a box inside an existing detection to cut that part off as its own item
    (a chair pulled out from a table).
  - *Merge:* select an item and merge it with a nearby one when one thing was detected in pieces.
  - *Identify with Claude* (inside Claude): sends Claude a top-down crop of the aerial view with
    the item outlined, plus its measured size and height, and suggests a type you can accept.
    *Identify all* labels everything in the list in one go, skipping things you typed yourself.
- **Suggests a layout.** The planner moves every movable piece (things already in the
  yard and new furniture you add) so that:
  - fire pits and grills stay 10 ft from the house and trees, with open sky overhead
  - each piece keeps its clearance (3 ft to pull out dining chairs, the 6 ft fall zone
    around a play set)
  - there is a clear path from the back door to everything
  - garden beds get sun, hammocks get shade, sheds tuck against the back edge
  - the largest possible open lawn is left over

  Every suggestion is explained ("13′ from the house, outside the 10 ft safety distance;
  open sky above"). You can apply one move at a time, apply them all, or ask for another option.
- **Imports furniture sizes.** Paste a size (`72" x 40" x 30"`, `183 x 102 x 76 cm`,
  `6' x 3'4"`, `32 in. diameter`), the specs section copied from a product page, or a link.
  It picks the overall size and ignores package, seat and arm sizes. Stores don't let other
  websites read their pages, so for links use the **Grab furniture size** bookmark: drag it to
  your bookmarks bar, click it on any product page, and paste what it copies. Inside Claude,
  **Ask Claude** can also read messy specs or estimate a size from a link or product name
  (marked as an estimate).
- **Lets you say what everything is.** Every piece, scanned or planned, has a *Type*: furniture,
  plants (tree, shrub, hedge, flower bed, boulder) or features (house, fence, wall, shed,
  deck, pool, AC unit). The type sets the label, the 3D model, whether it starts Fixed, and
  the placement rules (new trees at least 15 ft from the house, shrubs and hedges along the edges).
- **Shows what it will look like.** The 3D tab shows the scan with simple models of each piece.
  Give any piece a **product photo** (it stands in the yard as a cutout) or a **texture photo**
  (wood, stone, fabric), or pick a built-in finish. For yards without a scan, you can add a
  **background photo** such as a satellite screenshot.
- **Hands off to Claude.** *Copy for Claude* puts a text summary of the yard, its features
  and your layout on the clipboard to paste into a Claude chat.

## Scanning tips

1. In Polycam, scan with **LiDAR** or **Photo** mode. Walk the edges of the yard first,
   then sweep across the middle. Capture tree trunks and the base of fences.
2. Export as **GLB** (best). OBJ (with its MTL and texture files, or zipped together), PLY,
   STL and FBX also work. USDZ cannot be read in a browser.
3. Drop the file onto *Load your scan*. The plan is straightened to line up with the fences
   and turned so the house runs along the top.
4. Check one known length with **Measure** (a fence panel, a patio slab). If it is off,
   enter the real length and press *Rescale*.

No scan? Use *No scan? Enter the size* and add your existing pieces from the furniture list,
then lock them in place.

## Running it

It is a static site with no build step:

```bash
npm run serve
```

Then open <http://localhost:8000>. Three.js loads from the jsDelivr CDN.

To publish on GitHub Pages, enable Pages for the repository with **Source: GitHub Actions**.
The workflow in `.github/workflows/pages.yml` runs the tests and deploys on every push to `main`.

`npm run build:artifact` (after `npm install`) writes `dist/yard-maker.html`, a single
self-contained page used to publish the app as a Claude artifact.

## How it works

| File | Role |
| --- | --- |
| `js/scan.js` | Loads the export and renders it with orthographic cameras straight down and straight up into small offscreen targets. These passes give the top surface, the ground, and the lowest thing standing above the ground in each cell (to tell walk-under canopy from obstacles). Steep triangles such as walls and trunks are also walked on the CPU, because a top-down render sees them edge-on. |
| `js/analyze.js` | Cleans the ground surface, finds obstacles and canopy, groups obstacles into features and labels them. |
| `js/optimizer.js` | Scores a layout (hard limits, clearances, placement rules, walkway reachability, open lawn size) and searches with a greedy seed followed by simulated annealing. |
| `js/catalog.js` | Furniture and plant sizes, clearances, placement rules, and feature types. |
| `js/identify.js` | Aerial-view crops and the prompt for Identify with Claude. |
| `js/importer.js` | Reads pasted sizes, product specs and bookmark output; the bookmark itself. |
| `js/notes.js` | Writes the plain-language suggestions and the summary for Claude. |
| `js/plan.js`, `js/view3d.js`, `js/looks.js` | 2D plan, 3D preview, finishes and models. |

```bash
npm test
```

runs the unit tests for the grid math, the yard analysis and the optimizer.
