# My SuperApp

## Product direction

Read `DESIGN.md` before changing the interface.

## Owner's workflow

- Expo Go is for the owner's physical iPhone. Keep it available during development.
- Finish implementation, then build a standalone iOS Simulator `.app` with `native-sim --mode build`. Inspect screens and exercise functionality there. Correct defects, rebuild, and verify again before finishing. An `.ipa` targets a physical iPhone, not the simulator.
- This is the owner's personal app. Do not explain obvious controls or add instructional/promotion cards such as descriptions of light/dark appearance or how to paste a video URL. Show functional labels, content, and necessary recovery messages only.
- A full redesign includes reconsidering the screen containers and layout structure. Existing UI components are not a constraint; preserve data and behavior, not inherited layout defects.
- Verify empty, populated, loading, and error states. Headers must stay top-aligned in every state.

<!-- antislop:start -->
## antislop
For UI, copy, people, mobile layout, or code comments work, read the relevant antislop instructions before editing:
- Core filter: `C:\Users\edwar\.codex\plugins\cache\anti-slop\antislop\3.2.6\skills\antislop\SKILL.md`
- UI / visual: `C:\Users\edwar\.codex\plugins\cache\anti-slop\antislop\3.2.6\skills\antislop-ui\SKILL.md`
- Copy & text: `C:\Users\edwar\.codex\plugins\cache\anti-slop\antislop\3.2.6\skills\antislop-copywriting\SKILL.md`
- People: `C:\Users\edwar\.codex\plugins\cache\anti-slop\antislop\3.2.6\skills\antislop-human\SKILL.md`
- Mobile / responsive: `C:\Users\edwar\.codex\plugins\cache\anti-slop\antislop\3.2.6\skills\antislop-layoutmobile\SKILL.md`
<!-- antislop:end -->
