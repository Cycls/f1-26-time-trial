# TIME TRIAL — assertion results
Measured by `tools/probe_game.mjs` (independent of the builder's own claims).

```
PASS  lap timer runs
FAIL  all 3 sectors fire in order            (saw [0,1] - sector 3 never fires)
PASS  crossing the line rolls the lap over   (last=20.000, lap number advanced)
PASS  lap valid while on track
PASS  sliver of tyre on the line stays legal (lat = 0.98 x halfWidth)
PASS  all four wheels beyond the line invalidates  (lat = halfWidth + 4 m, wheelsOff=4)
PASS  ghost state exists
PASS  delta field is finite
PASS  best-lap persistence wired
PASS  TT: tyre wear not accumulating (correct - wear is OFF in Time Trial)
```

**9 / 10.** The track-limits rule matches the reference exactly: four wheels fully beyond the white
line deletes the lap, a sliver of tyre still on the line is legal.

## The one failure
**Sector 3 never fires.** Sectors 1 and 2 register; the third does not. Its boundary coincides with
the start/finish line, so the sector-3 split is very likely being consumed by the lap-rollover branch
before `sectorDone[2]` is set. Consequence: no third sector time, so the purple/green/yellow
classification for S3 can never display and a full three-sector breakdown on the lap-complete panel
is impossible. Fix is confined to the ordering of the sector check versus the lap-crossing check in
`src/game/timetrial.js`.
