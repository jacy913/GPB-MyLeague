# GPB Feature: “What the Numbers Don't Tell You” — Eight Team-Based Top 8 Rankings

## Objective

Implement a new GPB analytics feature titled **WHAT THE NUMBERS DON'T TELL YOU**, containing eight independent, team-based Top 8 rankings.

This feature should surface unusual, interesting, and statistically meaningful stories from the league's existing game data. It is not a conventional standings page and should not simply rank the best teams overall.

**Prioritize correct calculations, data integrity, and consistency with the existing GPB codebase.** Before writing code, inspect the relevant models, game engine, analytics utilities, season/phase filtering, team identifiers, and game storage format. Reuse existing functions wherever appropriate. Do not duplicate metric definitions unnecessarily or invent unavailable data.

## The eight rankings

### 1. 2nd Half Kings

**Question:** Which teams score the most runs in the second half of games?

**Primary ranking metric:** Total runs scored in innings 5 and later, aggregated across eligible completed games.

**Logic:**
- Use each game's `stats.lineScore` if it reliably records the runs scored by each team in every inning.
- Count runs scored by each team from the fifth inning through the end of the game.
- Include extra innings in the total.
- Aggregate runs scored across the selected season and phase.
- A team that scores 20 runs after the fourth inning ranks above one that scores 19, regardless of total season runs.

**Important distinctions:**
- “Second Half” refers to the second half of an individual game, not the second half of the season.
- Rank by total runs scored, not late-inning run differential, comeback wins, or winning percentage.
- Games that finish before the fifth inning contribute zero late-inning runs, provided their score data is valid.
- Do not infer inning-level runs from final scores when inning-level data is available.

**Suggested supporting statistics:** Late-inning runs, late-inning runs allowed, and late-inning run differential.

### 2. Giant Slayers

**Question:** Which teams perform best against opponents that finish the season above .500?

**Primary ranking metric:** Win percentage against qualifying opponents.

**Logic:**
1. Determine each opponent's final regular-season winning percentage for the relevant season.
2. Classify an opponent as a qualifying “giant” if its regular-season winning percentage is strictly greater than .500.
3. For each team, identify its completed games against those qualifying opponents.
4. Calculate:

   `Giant Slayer Win % = Wins Against Qualifying Opponents / Games Against Qualifying Opponents`

5. Rank teams by this percentage, highest first.

**Critical implementation detail:** When deciding whether Team A's opponent qualifies, calculate the opponent's winning percentage *excluding games played against Team A*. This prevents a team from helping determine whether its own opponent qualifies. Use that same opponent-specific calculation consistently throughout the ranking.

**Season and phase rules:**
- Use the final regular-season record to classify opponents, even when evaluating a different phase of that season.
- When the selected phase is the regular season, count only eligible regular-season head-to-head games in the team's numerator and denominator.
- If the selected phase is postseason, classify opponents using their regular-season records, then evaluate the selected postseason games against those opponents.
- Exclude incomplete games and games outside the selected evaluation scope.

**Edge cases:**
- If a team has no games against qualifying opponents, it has no meaningful percentage and should not be artificially ranked at 0%.
- Display the percentage at one decimal with a percent sign, such as `64.5%`, with the record it came from (`12–7`) as a supporting figure. Percentages read as `64.5%`, never `.645`.
- Use a minimum-opportunity threshold only if needed to avoid misleading rankings; if applied, disclose it and keep it consistent.

**Suggested supporting statistics:** Wins against qualifying opponents, losses, record, win percentage, and number of qualifying opponents faced.

### 3. One-Run Specialists

**Question:** Which teams win the most consistently in games decided by exactly one run?

**Primary ranking metric:** Winning percentage in one-run games.

**Logic:**
1. For each completed game, calculate the absolute difference between the two teams' final scores.
2. If the difference equals exactly one run, include the game in the one-run sample.
3. Attribute one win and one loss to the appropriate teams.
4. Aggregate each team's one-run record.
5. Calculate:

   `One-Run Win % = One-Run Wins / One-Run Games Played`

6. Rank teams by winning percentage, highest first.

**Rules:**
- Include extra-inning games.
- Exclude games decided by zero runs or by two or more runs.
- Do not rank teams with zero one-run games using a fabricated percentage.
- Display the win-loss record and winning percentage.
- Use total one-run wins as the first tie-breaker, then total one-run games played.

Do not treat this ranking as proof of a repeatable clutch skill. Small samples can produce extreme records.

### 4. Comeback Kids

**Question:** Which teams win most often after trailing at the end of the fourth inning?

**Primary ranking metric:** Number of wins in which the team was trailing at the end of the fourth inning.

**Logic:**
1. Inspect each completed game's `stats.lineScore` or `stats.playLog`.
2. Reconstruct the score after the fourth inning has fully concluded, including all scoring in the bottom of the fourth.
3. Determine whether either team was trailing at that checkpoint.
4. If a team was trailing at the checkpoint and eventually won the completed game, count one comeback win for that team.
5. Aggregate comeback wins across the selected season and phase.
6. Rank by comeback-win count, highest first.

**Critical checkpoint requirement:**
- Do not simply take the last play-log event whose inning equals four unless the event ordering and `HALF_END` handling prove that the bottom of the fourth has concluded.
- If the game has not completed the fourth inning, exclude it from comeback evaluation.
- If the score is tied after the fourth inning, neither team qualifies as trailing.
- If the game proceeds into extra innings, use the score after the fourth inning as the checkpoint and the actual final result as the outcome.
- Only completed games should count.

**Supporting statistics:**
- Comeback wins.
- Number of games in which the team trailed after four innings.
- Comeback conversion percentage:

  `Comeback Conversion % = Comeback Wins / Games Trailing After Four`

The conversion percentage is a secondary statistic. The primary ranking is based on comeback-win count.

**Validation:** Test home and away teams separately, tied checkpoints, games ending before the fifth inning, extra innings, and games where the score changes during the bottom of the fourth.

### 5. Shutout Wins

**Question:** Which teams have won the most games without allowing any runs?

**Primary ranking metric:** Number of shutout victories.

**Logic:**
1. Inspect each completed game's final score.
2. If a team wins and its opponent's final score is exactly zero, count one shutout win for the winning team.
3. Aggregate shutout wins by team for the selected season and phase.
4. Rank by shutout wins, highest first.

**Rules:**
- A 1–0 victory counts as a shutout win.
- A 0–0 game should not count as a win; in normal GPB game results, it should not be a completed decisive result.
- Extra-inning shutouts count.
- A team that loses 0–3 does not receive a shutout win.
- Do not infer shutouts from pitcher statistics when the final team score is available.

**Suggested supporting statistics:** Shutout wins, total wins, and shutout wins as a percentage of total wins. The ranking itself should remain based on the number of shutout victories.

### 6. Fence Leapers

**Question:** Which teams rely most heavily on home runs to produce their runs?

**Primary ranking metric:** Percentage of a team's total runs that were scored on home-run plays.

**Logic:**
1. Parse each eligible completed game's `stats.playLog`.
2. Identify events where `outcome === 'HR'`.
3. For each home-run event, add its `runsScored` value to the batting team's total runs scored on home-run plays. This should include the batter and any runners who score on the home run.
4. Aggregate home-run-play runs by team for the selected season and phase.
5. Obtain each team's total runs scored in the same scope.
6. Calculate:

   `HR Run Reliance % = Runs Scored on HR Plays / Total Runs Scored × 100`

7. Rank teams by this percentage, highest first.

**Important distinctions:**
- Rank by *run reliance*, not by home-run count or home runs per game.
- Use `runsScored` on the home-run event rather than assuming every home run produces exactly one run.
- Count each play-log event once.
- Exclude invalid or duplicate events if the data pipeline can produce them.
- Ensure the home-run-play runs are attributed to the correct batting team.
- If a team's total runs scored is zero, its percentage is undefined; do not fabricate a value.
- Validate that summed home-run-play runs never exceed the team's total runs scored in the same scope. If they do, investigate the data or attribution logic.

**Suggested supporting statistics:** Runs scored on home-run plays, total runs, home-run-run reliance percentage, and total home runs if reliably derivable from the event log.

This ranking intentionally measures how much of a team's offense comes from home runs, rather than how powerful the team is in absolute terms.

### 7. Heat Seeking Missiles

**Question:** Which teams win the highest share of their games in warm weather?

**Primary ranking metric:** Winning percentage in games with a recorded game temperature of 62°F or higher.

**Logic:**
1. Inspect the existing GPB weather implementation and game data model.
2. Identify the actual temperature recorded for each game.
3. Include a game in the warm-weather sample if its recorded temperature is `>= 62°F`.
4. For each eligible completed game, award one qualifying win to the winning team if the game temperature meets the threshold.
5. Aggregate qualifying wins and games by team and rank by winning percentage, highest first.

**Weather-data requirements:**
- The temperature must belong to the individual game, not simply be inferred from the team's home park.
- Prefer a persisted per-game weather snapshot so historical results remain stable if park defaults or weather-generation rules change.
- If temperature is stored in Celsius, convert it correctly before comparing it with the Fahrenheit threshold. Avoid rounding a Celsius value before classification if that could change the result.
- Do not invent weather values or use park mean temperature as if it were actual game weather.
- If per-game temperature is not currently recorded, report this dependency and identify the necessary schema and data-generation changes. Do not silently implement a misleading approximation.

**Supporting statistics:** Warm-weather wins, warm-weather games played, warm-weather winning percentage, and qualifying temperature range.

The ranking is based on warm-weather winning percentage, not total wins: a club that plays most of its games in the heat should not top the board over a cold-weather club on volume alone. Display the percentage at one decimal with a percent sign (`64.5%`), with wins and games as supporting figures.

### 8. Cold Blooded Killers

**Question:** Which teams win the highest share of their games in cold weather?

**Primary ranking metric:** Winning percentage in games with a recorded game temperature of 61°F or lower.

**Logic:**
1. Use the same per-game weather source as Heat Seeking Missiles.
2. Include a game in the cold-weather sample if its recorded temperature is `<= 61°F`.
3. For each eligible completed game, award one qualifying win to the winning team if the game temperature meets the threshold.
4. Aggregate qualifying wins and games by team and rank by winning percentage, highest first.

**Requirements:**
- Use the actual recorded game temperature.
- Convert Celsius to Fahrenheit when necessary, without premature rounding.
- Do not infer the temperature from a park's climate or mean temperature.
- Apply the same season, phase, completion, and tie-breaking conventions as Heat Seeking Missiles.
- If historical game temperatures are unavailable, document the required data changes instead of generating false historical precision.

**Supporting statistics:** Cold-weather wins, cold-weather games played, cold-weather winning percentage, and qualifying temperature range.

The thresholds are deliberately exclusive: 62°F qualifies as warm; 61°F qualifies as cold.

---

## Shared implementation requirements

### A. Data sources and architecture

Inspect and reuse the existing GPB systems before adding new code. Relevant known components include:

- Team season totals: wins, losses, runs scored, and runs allowed.
- Game records and `stats.lineScore`.
- `stats.playLog` and `PlayLogEvent`, including inning, half, batting team, outcome, runs scored, and final score snapshots.
- Existing season and phase filtering.
- Existing team identifiers and logo/color mappings.
- Existing analytics utilities in `src/lib/analytics/`.

The inventory previously provided indicates that `parks.json` contains park climate and mean-temperature information, but actual per-game weather records may not exist yet. Verify the current code before deciding what can be implemented immediately.

Use the existing project's conventions for file placement, types, tests, UI components, and error handling. A new derived analytics module would be appropriate if it fits the current architecture, but inspect the codebase first.

### B. Season and phase consistency

All eight rankings must use a consistent, explicit season and phase scope.

- Count completed games only.
- Exclude scheduled, in-progress, cancelled, or otherwise invalid games.
- Do not accidentally mix games from different seasons.
- Respect the existing GPB definitions for regular season and postseason phases.
- Where the metric depends on historical context, document that context. Giant Slayers is the main example: opponents are classified by regular-season performance, while the evaluated head-to-head record follows the selected phase.
- Avoid double-counting a game if it appears in multiple data collections or is represented by multiple records.
- Recompute derived metrics from authoritative source data when feasible rather than trusting potentially stale cumulative values.

### C. Ranking and tie-breaking

Every list must return up to eight teams, sorted by its designated primary metric.

- Do not manufacture eight entries if fewer than eight teams have eligible data.
- For count-based rankings, sort by the primary count descending.
- For percentage-based rankings, sort by the primary percentage descending, then use the relevant sample size or win count as a documented tie-breaker.
- Use a deterministic final tie-breaker, such as team ID or team name, so ordering does not change arbitrarily between renders.
- Do not use secondary statistics to silently replace the primary metric.
- If teams tie on the primary metric, use a consistent policy: either retain tied ranks or use a deterministic secondary ordering. Follow existing GPB UI conventions if they already define ranking ties.

### D. Missing and invalid data

- Missing data must not be treated as zero unless zero is genuinely the correct value.
- Handle empty samples and zero denominators explicitly.
- Do not let a missing play log silently produce a valid-looking zero for Comeback Kids or Fence Leapers.
- Where possible, use reliable line-score or final-score data for metrics that do not require play-by-play.
- If required historical data is unavailable, mark the relevant ranking as unavailable or document the prerequisite.
- Never fabricate historical game temperatures or retroactively assign weather conditions without an authoritative source.

### E. Tests and validation

Add tests using representative completed-game fixtures. At minimum, cover:

1. Second-half scoring across innings five through nine and extra innings.
2. Giant Slayers opponent qualification, including an opponent exactly at .500 and the exclusion of the evaluated team's own head-to-head games from opponent qualification.
3. One-run wins, one-run losses, extra innings, and games with larger margins.
4. Comeback wins after trailing at the end of the fourth, including bottom-of-fourth scoring, tied checkpoints, and games ending before the checkpoint.
5. Shutout wins for both home and away teams, including 1–0 games.
6. Fence Leapers home runs with multiple runners scoring and correct run attribution.
7. Heat Seeking Missiles at exactly 62°F and Cold Blooded Killers at exactly 61°F.
8. Celsius-to-Fahrenheit conversion if required by the actual data model.
9. Incomplete games, missing logs, duplicate records, empty samples, and zero denominators.
10. Correct season and phase filtering across multiple seasons.

### F. Deliverables

Implement the eight rankings using existing data wherever possible, and provide:

1. A short summary of the implementation and the files changed.
2. The exact calculation used for each ranking.
3. Tests added and their results.
4. Any missing-data dependencies, especially per-game weather.
5. Any assumptions made about season/phase behavior or tie-breaking.

Do not add unrelated analytics, new ranking categories, or unnecessary simulation mechanics. The goal is a focused, reliable set of eight Top 8 lists that reveal interesting stories from GPB's existing statistical universe.