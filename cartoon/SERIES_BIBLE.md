# THE BOX — Series Bible (10 × 5–7 min)

**Logline.** Every night a giant Hand reaches into an old toy box in an attic and takes one resident. Kubik, a red LEGO brick who has never broken a rule, and Lime, a fallen grocery lime with only 10 days before he dries out, must learn where the missing ones go before it is too late.

**Hook.** Lime's clock is ticking. Each episode his skin darkens and wrinkles (`age` parameter in the engine: ep1 = 0.06 → ep10 = 1.0), so the audience literally watches time run out.

## Season mysteries
1. Where does the Hand take the residents, and why them? (47 gone.)
2. Why is one stud missing from Kubik, and why does the Hand never take him?
3. What is Tik-Tak, the Old Alarm Clock who rules the Box, hiding?

## Truth (revealed in the finale)
The Hand is **Alina**, the grown-up owner. She does not throw toys away: she repairs them, donates them to a children's home, or keeps them. Tik-Tak saw this through the Lid crack but invented the "Great Garbage Bin" legend: he is a clock stuck at 3:47 and is afraid a broken clock is worth nothing to anyone, so he wants to stay king of the only world where he matters. Kubik is the last piece of the LEGO house Alina built as a girl — the Hand leaves him because the missing stud is the piece she is saving to complete him; in the finale that hole becomes the most important part of him.

## Cast & voices (Kokoro TTS casting in `audio.py`)
| Character | What | Voice | Secret / arc |
|---|---|---|---|
| Kubik | Red LEGO 2×4, one stud missing | `am_liam` | Never broke a rule; ashamed of the hole |
| Lime | Green lime, ~10 days left | `am_puck` | Fearless, nicknames everyone; hides his clock until ep5 |
| Tik-Tak | Alarm clock, stuck at 3:47, speaks "for your safety" | `bm_george` | Fake legend; ticks with his voice |
| Tsap | Blunt kids' scissors, loud guard | `am_onyx` | Switches sides in ep9 |
| Tisha | Pearl button, whispers, knows every rumor | `af_nicole` | Helps the heroes, but is Tik-Tak's spy (ep7) |
| Iskra | Half-charged battery, sparks when nervous | `af_nova` | Taken in ep1, found outside as a flashlight light in ep6 |
| Oneeye | One-eyed plush bear, hermit on the Bottom | — | Tik-Tak's former best friend; knows Kubik's past |
| The Hand | Silent; only palm and fingers | — | Alina |

Design rule: big eyes + mouth only, no arms or legs — characters hop, roll and slide (cheap to animate, instantly readable).

## World
- **Lid** — slit of light = the "sun"; the Hand descends here at night.
- **Town** — matchbox houses, Tik-Tak's tower of thread spools.
- **Bottom** — dark lower level of the "Forgotten" (broken/lost things). Forbidden.

**Tik-Tak's laws:** 1) Lid opens → freeze and be silent. 2) Never go to the Bottom. 3) Never look into the light.

## Episode guide (one night per episode, each ends on a cliffhanger)
| # | Title | Lime's clock | Story | Cliffhanger |
|---|---|---|---|---|
| 1 | **The Falling Lime** *(produced)* | Day 1 — first dark spot | Lime falls in; Tik-Tak's three laws; Iskra is taken (#48) | Tisha: Tik-Tak wasn't frozen — he looked up at the Hand, smiling |
| 2 | The Forbidden Stairs | Day 2 | Heroes sneak to the Bottom at dusk; meet the Forgotten; Tsap chases them | A voice from the dark: "You have his stud…" |
| 3 | Oneeye | Day 3 | The hermit bear tells half the Box's history, hints at Kubik's origin | Oneeye knows Tik-Tak's real name — and he is not a villain's name |
| 4 | The Crack in the Light | Day 4 | Heroes climb the Lid to look through the slit (law 3) | Lime sees something outside — and falls back before telling |
| 5 | Ten Days | Day 5 | Kubik discovers Lime's secret; their fight and reconciliation | The Hand hovers over Lime — and chooses someone else |
| 6 | The Flashlight | Day 6 | A light signal from outside; proof Iskra is alive | Tisha sends the signal's location to Tik-Tak |
| 7 | The Spy | Day 7 | Tisha's betrayal exposed; she is torn | Tik-Tak locks the Box: "No one leaves the Town." |
| 8 | Stopped Time | Day 8 | Heroes reach Tik-Tak's tower; his stopped hands, his real story | Tik-Tak breaks the Lid's latch to stop the Hand |
| 9 | Tsap Chooses | Day 9 | Tsap switches sides; Box-wide escape plan | The Hand reaches for Lime — Kubik jumps |
| 10 | The Hole | Day 10 | Alina's workshop: repair, a new stud, a box for the children's home. Lime isn't thrown away — he's planted | Tik-Tak gets a new clockwork heart; Kubik's hole finds its purpose |

## Production pipeline (this repo, `cartoon/`)
- `engine.py` — vector 2D engine on Skia (characters, world, hand, captions, cards).
- `audio.py` — Kokoro neural TTS per character, procedural music (day / tense / warm) and SFX.
- `director.py` — sequential scripting API (`say`, `hop`, `roll`, `cam`, `hand_to`, …), lip-sync from voice amplitude, parallel render + ffmpeg mux.
- `episode01.py` — script of episode 1. New episodes = new `episodeNN.py` with the same API.
- Render: `KOKORO_DIR=<dir with kokoro.onnx + voices.bin> python3 episode01.py render out/ep01.mp4 /tmp/work`
