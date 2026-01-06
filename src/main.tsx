/**
 * SolutionPinner
 * Copyright (c) 2026 [Your Name/Handle]
 * * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

// Learn more at developers.reddit.com/docs
import { Devvit, useState, useAsync, TriggerContext } from "@devvit/public-api";

Devvit.configure({
  redditAPI: true,
  redis: true,
});

const createPost = async (context: Devvit.Context | TriggerContext) => {
  const { reddit } = context;
  const subreddit = await reddit.getCurrentSubreddit();
  const post = await reddit.submitPost({
    title: "My devvit post",
    subredditName: subreddit.name,
    // The preview appears while the post loads
    preview: (
      <vstack height="100%" width="100%" alignment="middle center">
        <text size="large">Loading ...</text>
      </vstack>
    ),
  });

  return post;
};

// Add a menu item to the subreddit menu for instantiating the new experience post
Devvit.addMenuItem({
  label: "Add my post",
  location: "subreddit",
  forUserType: "moderator",
  onPress: async (_event, context) => {
    const { reddit, ui } = context;
    ui.showToast(
      "Submitting your post - upon completion you'll navigate there."
    );

    const post = await createPost(context);

    ui.navigateTo(post);
  },
});

// Debug: show stored solution id for the active post (visible to moderators)
Devvit.addMenuItem({
  label: "Debug: Show solution key",
  location: "post",
  forUserType: "moderator",
  onPress: async (_event, context) => {
    const ui = context.ui;
    const postId = (context as any).postId ?? (context.postId as string | undefined);
    if (!postId) {
      await ui.showToast("No postId available in this context");
      return;
    }

    const key = `solution:${postId}`;
    try {
      const val = await context.redis.get(key);
      if (val) {
        await ui.showToast(`${key} => ${val}`);
      } else {
        await ui.showToast(`${key} not set`);
      }
    } catch (e) {
      console.error(e);
      await ui.showToast(`Error reading ${key}`);
    }
  },
});

// Convert a regular post into an app-owned Devvit post by reposting its contents.
Devvit.addMenuItem({
  label: "Convert to Devvit post",
  location: "post",
  forUserType: "moderator",
  onPress: async (_event, context) => {
    const ui = context.ui;
    const reddit = context.reddit;
    const postId = (context as any).postId ?? (context.postId as string | undefined);
    if (!postId) {
      await ui.showToast("No postId available");
      return;
    }

    try {
      const orig = await reddit.getPostById(postId);
      if (!orig) {
        await ui.showToast("Original post not found");
        return;
      }

      const subreddit = await reddit.getCurrentSubreddit();
      const title = `Devvit copy: ${orig.title ?? "Untitled"}`;
      const originalUrl = orig.permalink ? `https://www.reddit.com${orig.permalink}` : undefined;
      const text = `${originalUrl ? `Original: ${originalUrl}\n\n` : ""}---\n\n${orig.body ?? "(no body)"}`;

      ui.showToast("Creating Devvit-owned copy of this post...");

      const newPost = await reddit.submitPost({
        title,
        subredditName: subreddit.name,
        text,
        // lightweight preview while the post loads
        preview: (
          <vstack height="100%" width="100%" alignment="middle center">
            <text size="large">Creating copy...</text>
          </vstack>
        ),
      });

      // Attach metadata linking back to original post so we can trace it
      try {
        await newPost.setPostData({ originalPostId: postId });
        console.debug(`Set postData on new post ${newPost.id} -> original ${postId}`);
      } catch (e) {
        console.error(`Failed to set postData on new post ${newPost?.id}:`, e);
      }

      ui.showToast("Devvit copy created — navigating there now.");
      await ui.navigateTo(newPost);
    } catch (e) {
      console.error("Failed to convert post:", e);
      await ui.showToast("Conversion failed — see logs");
    }
  },
});

Devvit.addTrigger({
  event: "CommentCreate",
  onEvent: async (event, context) => {
    const created = event?.comment;
    if (!created) return;

    const body = (created.body || "").trim();
    // Accept commands anywhere in the comment: !solved, !solution, !answer (case-insensitive)
    // Match when '!' is at start or preceded by a non-alphanumeric character so it works
    // when the command appears mid-sentence (e.g., "Thanks — that worked! !solved").
    const commandRegex = /(^|[^A-Za-z0-9])!(?:solved|solution|answer)\b/i;
    const accepted = commandRegex.test(body);
    if (!accepted) {
      // Keep legacy normalized debug info for logs
      const normalized = body.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9!]/g, "");
      console.debug(`Ignored !solved trigger — body="${body}" normalized="${normalized}"`);
      return;
    }

    const postId = created.postId;
    if (!postId) return;

    // Verify OP or subreddit moderator: prefer included post, otherwise fetch it.
    let isOp = false;
    if (event.post) {
      isOp = event.post.authorId === created.author;
    } else {
      try {
        const post = await context.reddit.getPostById(postId);
        isOp = !!post && post.authorId === created.author;
      } catch (e) {
        // if we can't fetch, conservatively abort
        return;
      }
    }

    // Try to detect whether the commenter is a moderator of the subreddit.
    // Different runtimes expose moderator checks differently; attempt several safe probes
    // and fall back to denying action if none succeed.
    let isModerator = false;
    try {
      const subreddit = await context.reddit.getCurrentSubreddit?.();
      if (subreddit) {
        // Common helper: isUserModerator(subredditName, userId)
        if (typeof (context.reddit as any).isUserModerator === "function") {
          isModerator = await (context.reddit as any).isUserModerator(subreddit.name, created.author);
        } else if (typeof (context.reddit as any).getModerators === "function") {
          const mods = await (context.reddit as any).getModerators(subreddit.name);
          if (Array.isArray(mods)) {
            isModerator = mods.some((m: any) => m.id === created.author || m.name === created.author);
          }
        } else if (typeof (context.reddit as any).isModerator === "function") {
          // fallback single-arg check
          isModerator = await (context.reddit as any).isModerator(created.author);
        }
      }
    } catch (e) {
      console.debug('Moderator check failed:', e);
    }

    // Allow marking a solution if the commenter is the OP or a subreddit moderator.
    if (!isOp && !isModerator) return;

    const solutionId = created.parentId;
    if (!solutionId) return;

    const key = `solution:${postId}`;
    try {
      // If there is an existing solution recorded, remove its verification reply
      // so we don't leave multiple 'Verified solution' comments pinned.
      try {
        const prevSolutionId = await context.redis.get(key);
        if (prevSolutionId && prevSolutionId !== solutionId) {
          // Attempt to remove previous bot reply (stored separately)
          try {
            const prevReplyKey = `solution_reply:${postId}`;
            const prevReplyId = await context.redis.get(prevReplyKey);
            if (prevReplyId) {
              console.debug(`Found previous verification reply id for ${postId}: ${prevReplyId}`);
              const prevReply = await context.reddit.getCommentById(prevReplyId).catch((err) => {
                console.debug(`getCommentById(${prevReplyId}) failed:`, err);
                return null;
              });
              if (prevReply) {
                try {
                  console.debug('Prev reply object methods:', {
                    hasRemove: typeof (prevReply as any).remove === 'function',
                    hasDelete: typeof (prevReply as any).delete === 'function',
                    hasDestroy: typeof (prevReply as any).destroy === 'function',
                    hasEdit: typeof (prevReply as any).edit === 'function',
                    hasDistinguish: typeof (prevReply as any).distinguish === 'function',
                  });
                } catch (_) {}

                // Try to undistinguish/unpin first
                try {
                  await (prevReply as any).distinguish?.(false).catch((e: any) => { console.debug('distinguish(false) failed:', e); });
                } catch (_) {}

                // Try first-class removal methods on the comment object
                let removed = false;
                try {
                  if (typeof (prevReply as any).remove === 'function') {
                    await (prevReply as any).remove();
                    removed = true;
                  } else if (typeof (prevReply as any).delete === 'function') {
                    await (prevReply as any).delete();
                    removed = true;
                  } else if (typeof (prevReply as any).destroy === 'function') {
                    await (prevReply as any).destroy();
                    removed = true;
                  }
                } catch (delErr) {
                  console.debug(`Comment-object deletion methods failed for ${prevReplyId}:`, delErr);
                }

                // Try reddit client helper delete methods if comment-object failed
                if (!removed) {
                  try {
                    const redditClient: any = context.reddit;
                    const clientDeleteFns = ['deleteComment', 'removeComment', 'remove', 'delete'];
                    for (const fn of clientDeleteFns) {
                      if (typeof redditClient[fn] === 'function') {
                        try {
                          await redditClient[fn](prevReplyId);
                          console.debug(`Deleted prev reply ${prevReplyId} via redditClient.${fn}`);
                          removed = true;
                          break;
                        } catch (clientErr) {
                          console.debug(`redditClient.${fn}(${prevReplyId}) failed:`, clientErr);
                        }
                      }
                    }
                  } catch (clientErr) {
                    console.debug('reddit client deletion attempts failed:', clientErr);
                  }
                }

                // Final fallback: edit the comment to indicate replacement
                if (!removed) {
                  try {
                      if (typeof (prevReply as any).edit === 'function') {
                      await (prevReply as any).edit?.('[Replaced by a new verified solution]\n\nThis used to be the old solution.');
                      console.debug(`Edited prev reply ${prevReplyId} to mark replaced`);
                      removed = true;
                    }
                  } catch (editErr) {
                    console.debug(`Failed fallback edit for ${prevReplyId}:`, editErr);
                  }
                }

                if (!removed) {
                  console.debug(`Unable to remove or edit previous verification reply ${prevReplyId}`);
                }
              } else {
                console.debug(`Previous reply id ${prevReplyId} not found via getCommentById`);
              }
              // Ensure the previous reply is hidden: attempt to edit it to '[removed]'
              try {
                  if (prevReply && typeof (prevReply as any).edit === 'function') {
                  await (prevReply as any).edit?.('[removed]\n\nThis used to be the old solution.').catch((e: any) => console.debug(`edit('[removed]') failed for ${prevReplyId}:`, e));
                  console.debug(`Attempted to edit prev reply ${prevReplyId} to '[removed]' and add note`);
                }
              } catch (editEnsureErr) {
                console.debug('Error while attempting final edit to hide previous reply', editEnsureErr);
              }

              try {
                await context.redis.del(prevReplyKey);
              } catch (_) {}
            }
          } catch (inner) {
            console.debug('Error while attempting to remove previous verification reply', inner);
          }
        }
      } catch (e) {
        console.debug('Error reading previous solution key', e);
      }

      console.debug(`Saving solution for post ${postId} -> ${solutionId}`);
      await context.redis.set(key, solutionId);
      console.debug(`Saved ${key} = ${solutionId}`);
      // Try to attach the verified solution id to the original post's postData
      try {
        const post = await context.reddit.getPostById(postId);
        if (post) {
          try {
            const existing = await (post as any).getPostData?.();
            if (existing === undefined) {
              console.debug(`Post ${postId} has no Devvit postData; skipping setPostData`);
            } else {
              await post.setPostData({ ...existing, verifiedSolutionId: solutionId });
              console.debug(`Set postData for ${postId} verifiedSolutionId=${solutionId}`);
            }
          } catch (innerErr: any) {
            let details = "";
            try {
              details = JSON.stringify(innerErr, Object.getOwnPropertyNames(innerErr));
            } catch (_) {
              details = String(innerErr);
            }
            console.error(`Failed to set postData for ${postId}: ${details}`);
            try {
              await context.redis.set(`solution_fallback:${postId}`, details || "failed");
              console.debug(`Set fallback key solution_fallback:${postId}`);
            } catch (e2) {
              console.error(`Failed to set fallback key for ${postId}:`, e2);
            }
          }
        }
      } catch (e: any) {
        console.error(`Failed to fetch post ${postId} for setPostData:`, e);
      }

      // Try to create a Verified Solution comment on the post and attempt to sticky it
      try {
        const solutionComment = await context.reddit.getCommentById(solutionId).catch(() => null);
        const permalink = solutionComment?.permalink ?? `https://www.reddit.com/comments/${postId}/_/${solutionId}`;
        const post = await context.reddit.getPostById(postId);
        if (post) {
          // Use a short labeled markdown link so the comment is concise and the link text is short
          const reply = await post.addComment({
            text: ` #### **Verified solution by OP** - [Navigate](${permalink})\n\n ^([Get solutionpinner](https://developers.reddit.com/apps/solutionpinner))`
          });
          // Store this verification reply id so we can remove it if a new solution replaces it later
          try {
            await context.redis.set(`solution_reply:${postId}`, reply?.id ?? "");
          } catch (_e) {
            console.debug('Failed to persist verification reply id', _e);
          }
          console.debug(`Posted verification comment ${reply?.id} on ${postId}`);
            try {
              // Attempt to distinguish + sticky the reply (will fail without moderator perms).
              // Don't rethrow here: just log failures so the trigger doesn't crash.
              await (reply as any).distinguish?.(true).catch((err: any) => {
                console.debug('distinguish/sticky failed:', err);
              });
              console.debug(`Distinguished and stickied comment ${reply?.id} (or attempted)`);
            } catch (err) {
              console.debug(`Could not distinguish/sticky comment ${reply?.id}:`, err);
            }

          // Flair setting removed per user request.
        }
      } catch (e) {
        console.error(`Failed to post verification comment for ${postId}:`, e);
      }
    } catch (e) {
      console.error(`Error saving ${key}:`, e);
    }
  },
});

// Add a post type definition
Devvit.addCustomPostType({
  name: "Experience Post",
  height: "regular",
  render: (context) => {
    const postId = (context as any).postId ?? (context.postId as string | undefined);

    // Poll Redis periodically so the custom block refreshes shortly after OP marks a new answer.
    const [solutionData, setSolutionData] = useState<{ solutionId: string; commentBody: string; permalink: string | null } | null>(null);
    const [expanded, setExpanded] = useState(false);

    useAsync(async () => {
      if (!postId) return null;
      const key = `solution:${postId}`;

      const fetchAndSet = async () => {
        const solutionId = await context.redis.get(key);
        if (!solutionId) {
          setSolutionData(null);
          return;
        }

        try {
          const comment = await context.reddit.getCommentById(solutionId).catch(() => null);
          const commentBody = comment?.body ?? "(deleted or unavailable)";
          const permalink = comment?.permalink ?? (postId && solutionId ? `https://www.reddit.com/comments/${postId}/_/${solutionId}` : null);
          setSolutionData({ solutionId, commentBody, permalink });
        } catch (e) {
          setSolutionData({ solutionId, commentBody: "(deleted or unavailable)", permalink: (postId && solutionId ? `https://www.reddit.com/comments/${postId}/_/${solutionId}` : null) });
        }
      };

      // initial fetch
      await fetchAndSet();

      // poll every 3s (no reliable cleanup API available in Blocks; this is acceptable for short-lived render contexts)
      setInterval(() => {
        fetchAndSet().catch((err) => console.error('Polling error', err));
      }, 3000);

      return null;
    }, { depends: [postId] });

    if (solutionData === undefined) {
      return (
        <vstack height="100%" width="100%" alignment="middle center">
          <text size="large">Loading …</text>
        </vstack>
      );
    }

    if (!solutionData) {
      return (
        <vstack height="100%" width="100%" gap="small" alignment="center middle" padding="medium">
          <text size="large">Help Wanted</text>
          <text>
            The OP hasn't verified a solution yet. The OP or a subreddit moderator can mark a verified
            solution by replying to a helpful comment with <text weight="bold">!solved</text>.
          </text>
        </vstack>
      );
    }

    const { solutionId, commentBody, permalink } = solutionData;

    const maxLength = 1000;
    const isLong = commentBody.length > maxLength;
    const displayBody = !isLong || expanded ? commentBody : commentBody.slice(0, maxLength) + "…";

    return (
      <vstack
        height="100%"
        width="100%"
        gap="small"
        alignment="center middle"
        borderColor="green"
        border="thick"
        padding="medium"
      >
        <text size="medium" weight="bold">Verified Solution</text>
        <text>{displayBody}</text>
        {isLong && (
          <button appearance="subtle" onPress={() => setExpanded(!expanded)}>
            {expanded ? "Show less" : "Show more"}
          </button>
        )}
        {permalink && (
          <vstack gap="small" alignment="center middle">
            <button appearance="primary" onPress={() => context.ui.navigateTo(permalink)}>
              Go to answer
            </button>
            <text size="xsmall">
              Solutionpinner - add to your subreddit
            </text>
            <button
              appearance="subtle"
              onPress={() => context.ui.navigateTo("https://developers.reddit.com/apps/solutionpinner")}
            >
              Learn more
            </button>
          </vstack>
        )}
      </vstack>
    );
  },
});

export default Devvit;
