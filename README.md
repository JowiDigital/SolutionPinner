# Getting started with solutionpinner

Are you ready to let users pin solutions to their questions? With the SolutionPinner the OP of a post can comment '!solved' under the person who helped them solve their problem. Doing this pins this comment and the location to the top of the post.

![Example](https://i.imgur.com/qfO5plM.png)

## How the app works (In detail)

- Trigger: the app listens for `CommentCreate` events and accepts commands matching `!solved`, `!solution`, or `!answer` anywhere in the comment (case-insensitive).
- Permission check: the OP or a subreddit moderator can mark a solution. The app verifies the commenter before saving.
- Storage: verified answers are stored in Redis under `solution:<postId>`. The verification reply id is stored under `solution_reply:<postId>` to allow replacement/removal.
- UI: the `Experience Post` block shows the verified solution text (truncated with a "Show more" toggle for long text) and a button to navigate to the original comment. If the original comment is deleted or unavailable, the block shows "(deleted or unavailable)".

## Example

1. OP or moderator replies to a helpful comment with `!solved`.
2. The app verifies OP/mod status, records the answer id in Redis, and posts a short verification comment linking to the answer.
3. The `Experience Post` block reads Redis and displays the verified solution (or placeholder if unavailable).

## Repository

The source for this app is hosted on GitHub:

[https://github.com/JowiDigital/SolutionPinner](https://github.com/JowiDigital/SolutionPinner)