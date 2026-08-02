# Resources

Source art assets, kept tracked for provenance. These are the **originals**; the
build-served copies live in `app/public/` (renamed for clarity) and are what the site
actually loads. Edit here → re-copy to `app/public/` if you change them.

## `osrs-ui/`: Old School RuneScape UI resource pack (by Rohan)

Hand-made OSRS resource pack; the medieval gold trim is worked into the site's
container borders and tab icon.

The card frame (`.gold-frame::after` overlay in `app/src/index.css`) is built
entirely from the `iron_rivets_*` art so corners and rails share one palette:

| Source | Served as | Frame role |
|---|---|---|
| `osrs-ui/frame/iron_rivets_corner_top_left` (25×30) | `iron-corner-tl.png` | top-left corner |
| `osrs-ui/frame/iron_rivets_corner_top_right` | `iron-corner-tr.png` | top-right corner |
| `osrs-ui/frame/iron_rivets_corner_bottom_left` | `iron-corner-bl.png` | bottom-left corner |
| `osrs-ui/frame/iron_rivets_corner_bottom_right` | `iron-corner-br.png` | bottom-right corner |
| `osrs-ui/frame/iron_rivets_bottom` (36×36, band near top) | `rail-top.png` | top rail (repeat-x) |
| `osrs-ui/frame/iron_rivets_edge_top` (36×21, band near bottom) | `rail-bottom.png` | bottom rail (repeat-x) |
| `osrs-ui/frame/iron_rivets_edge_right` (21×36, band near left) | `rail-left.png` | left rail (repeat-y) |
| `osrs-ui/frame/iron_rivets_vertical` (21×36, band near right) | `rail-right.png` | right rail (repeat-y) |

(Rail sources are named for the band position, not the side; the mapping above is
what actually aligns the band to each edge; verified against the corners.) The
overlay paints above card content so the trim shows over the flush thumbnail image
on portfolio cards.

Other assets:

| Source | Served as | Used for |
|---|---|---|
| `osrs-ui/frame/side_border_*` (8 pcs, 8×8 / 4×4) | n/a | Original gold trim; superseded by iron-rivets. Kept for reference. |
| `osrs-ui/orbs/minimap_orb_world_map_planet.png` (22×22) | `app/public/favicon-planet.png` | Browser tab icon (`app/index.html`) |
| `osrs-ui/orbs/minimap_orb_world_map_*` (frame / hovered) | n/a | On hand for future orb-style UI |

Pixel art: always render with `image-rendering: pixelated` when scaled up.
