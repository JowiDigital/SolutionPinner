# Getting started with solutionpinner

Are you ready to let users pin solutions to their questions? With the SolutionPinner the OP of a post can comment '!solved' under the person who helped them solve their problem. Doing this pins this comment and the location to the top of the post.

## How the app works (In detail)

# Getting started with solutionpinner

Are you ready to let users pin solutions to their questions? SolutionPinner lets the OP (or a subreddit moderator) mark a helpful reply as the verified solution by replying with `!solved` (the command may appear anywhere in the comment).

![Example](https://i.imgur.com/qfO5plM.png)

## How the app works (In detail)


## Example

1. OP or moderator replies to a helpful comment with `!solved`.
2. The app verifies OP/mod status, records the answer id in Redis, and posts a short verification comment linking to the answer.
3. The `Experience Post` block reads Redis and displays the verified solution (or placeholder if unavailable).

## Repository

The source for this app is hosted on GitHub:

- https://github.com/JowiDigital/SolutionPinner

