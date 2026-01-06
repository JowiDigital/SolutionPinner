/**
 * SolutionPinner
 * Copyright (c) 2026 [Your Name/Handle]
 * * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

// Learn more at developers.reddit.com/docs
import { Devvit, useState, useAsync } from "@devvit/public-api";
Devvit.configure({
    redditAPI: true,
    redis: true,
});
const createPost = async (context) => {
    const { reddit } = context;
    const subreddit = await reddit.getCurrentSubreddit();
    const post = await reddit.submitPost({
        title: "My devvit post",
        subredditName: subreddit.name,
        // The preview appears while the post loads
        preview: (Devvit.createElement("vstack", { height: "100%", width: "100%", alignment: "middle center" },
            Devvit.createElement("text", { size: "large" }, "Loading ..."))),
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
        ui.showToast("Submitting your post - upon completion you'll navigate there.");
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
        const postId = context.postId ?? context.postId;
        if (!postId) {
            await ui.showToast("No postId available in this context");
            return;
        }
        const key = `solution:${postId}`;
        try {
            const val = await context.redis.get(key);
            if (val) {
                await ui.showToast(`${key} => ${val}`);
            }
            else {
                await ui.showToast(`${key} not set`);
            }
        }
        catch (e) {
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
        const postId = context.postId ?? context.postId;
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
                preview: (Devvit.createElement("vstack", { height: "100%", width: "100%", alignment: "middle center" },
                    Devvit.createElement("text", { size: "large" }, "Creating copy..."))),
            });
            // Attach metadata linking back to original post so we can trace it
            try {
                await newPost.setPostData({ originalPostId: postId });
                console.debug(`Set postData on new post ${newPost.id} -> original ${postId}`);
            }
            catch (e) {
                console.error(`Failed to set postData on new post ${newPost?.id}:`, e);
            }
            ui.showToast("Devvit copy created — navigating there now.");
            await ui.navigateTo(newPost);
        }
        catch (e) {
            console.error("Failed to convert post:", e);
            await ui.showToast("Conversion failed — see logs");
        }
    },
});
Devvit.addTrigger({
    event: "CommentCreate",
    onEvent: async (event, context) => {
        const created = event?.comment;
        if (!created)
            return;
        const body = (created.body || "").trim();
        // Accept commands anywhere in the comment: !solved, !solution, !answer (case-insensitive)
        const commandRegex = /(^|[^A-Za-z0-9])!(?:solved|solution|answer)\b/i;
        const accepted = commandRegex.test(body);
        if (!accepted) {
            console.debug(`Ignored !solved trigger — body="${body}" normalized="${normalized}"`);
            return;
        }
        const postId = created.postId;
        if (!postId)
            return;
        // Verify OP or subreddit moderator: prefer included post, otherwise fetch it.
        let isOp = false;
        if (event.post) {
            isOp = event.post.authorId === created.author;
        }
        else {
            try {
                const post = await context.reddit.getPostById(postId);
                isOp = !!post && post.authorId === created.author;
            }
            catch (e) {
                // if we can't fetch, conservatively abort
                return;
            }
        }

        // Detect moderator status using several possible client helpers.
        let isModerator = false;
        try {
            const subreddit = await context.reddit.getCurrentSubreddit?.();
            if (subreddit) {
                if (typeof context.reddit.isUserModerator === 'function') {
                    isModerator = await context.reddit.isUserModerator(subreddit.name, created.author);
                }
                else if (typeof context.reddit.getModerators === 'function') {
                    const mods = await context.reddit.getModerators(subreddit.name);
                    if (Array.isArray(mods)) {
                        isModerator = mods.some((m) => m.id === created.author || m.name === created.author);
                    }
                }
                else if (typeof context.reddit.isModerator === 'function') {
                    isModerator = await context.reddit.isModerator(created.author);
                }
            }
        }
        catch (e) {
            console.debug('Moderator check failed:', e);
        }

        if (!isOp && !isModerator)
            return;
        const solutionId = created.parentId;
        if (!solutionId)
            return;
        const key = `solution:${postId}`;
        try {
            console.debug(`Saving solution for post ${postId} -> ${solutionId}`);
            await context.redis.set(key, solutionId);
            console.debug(`Saved ${key} = ${solutionId}`);
            // Try to attach the verified solution id to the original post's postData
            try {
                const post = await context.reddit.getPostById(postId);
                if (post) {
                    try {
                        const existing = await post.getPostData?.();
                        if (existing === undefined) {
                            console.debug(`Post ${postId} has no Devvit postData; skipping setPostData`);
                        }
                        else {
                            await post.setPostData({ ...existing, verifiedSolutionId: solutionId });
                            console.debug(`Set postData for ${postId} verifiedSolutionId=${solutionId}`);
                        }
                    }
                    catch (innerErr) {
                        let details = "";
                        try {
                            details = JSON.stringify(innerErr, Object.getOwnPropertyNames(innerErr));
                        }
                        catch (_) {
                            details = String(innerErr);
                        }
                        console.error(`Failed to set postData for ${postId}: ${details}`);
                        try {
                            await context.redis.set(`solution_fallback:${postId}`, details || "failed");
                            console.debug(`Set fallback key solution_fallback:${postId}`);
                        }
                        catch (e2) {
                            console.error(`Failed to set fallback key for ${postId}:`, e2);
                        }
                    }
                }
            }
            catch (e) {
                console.error(`Failed to fetch post ${postId} for setPostData:`, e);
            }
            // Try to create a Verified Solution comment on the post and attempt to sticky it
            try {
                const solutionComment = await context.reddit.getCommentById(solutionId).catch(() => null);
                    const permalink = solutionComment?.permalink ?? `https://www.reddit.com/comments/${postId}/_/${solutionId}`;
                const post = await context.reddit.getPostById(postId);
                if (post) {
                    // Use a short labeled markdown link so the comment is concise and the link text is short
                    const reply = await post.addComment({ text: `Verified solution by OP - [Navigate](${permalink})` });
                    console.debug(`Posted verification comment ${reply?.id} on ${postId}`);
                        try {
                            // Attempt to distinguish + sticky the reply (will fail without moderator perms).
                            // Don't rethrow here; log failures so the trigger doesn't crash.
                            await reply.distinguish?.(true).catch((err) => {
                                console.debug('distinguish/sticky failed:', err);
                            });
                            console.debug(`Distinguished and stickied comment ${reply?.id} (or attempted)`);
                        }
                        catch (err) {
                            console.debug(`Could not distinguish/sticky comment ${reply?.id}:`, err);
                        }
                }
            }
            catch (e) {
                console.error(`Failed to post verification comment for ${postId}:`, e);
            }
        }
        catch (e) {
            console.error(`Error saving ${key}:`, e);
        }
    },
});
// Add a post type definition
Devvit.addCustomPostType({
    name: "Experience Post",
    height: "regular",
    render: (context) => {
        const postId = context.postId ?? context.postId;
        // Poll Redis periodically so the custom block refreshes shortly after OP marks a new answer.
        const [solutionData, setSolutionData] = useState(null);
        const [expanded, setExpanded] = useState(false);
        useAsync(async () => {
            if (!postId)
                return null;
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
                }
                catch (e) {
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
            return (Devvit.createElement("vstack", { height: "100%", width: "100%", alignment: "middle center" },
                Devvit.createElement("text", { size: "large" }, "Loading \u2026")));
        }
        if (!solutionData) {
            return (Devvit.createElement("vstack", { height: "100%", width: "100%", gap: "small", alignment: "center middle", padding: "medium" },
                Devvit.createElement("text", { size: "large" }, "Help Wanted"),
                Devvit.createElement("text", null,
                    "The OP hasn't verified a solution yet. The OP or a subreddit moderator can mark a verified",
                    " solution by replying to a helpful comment with",
                    Devvit.createElement("text", { weight: "bold" }, "!solved"),
                    ".")));
        }
        const { solutionId, commentBody, permalink } = solutionData;
        const maxLength = 1000;
        const isLong = commentBody.length > maxLength;
        const displayBody = !isLong || expanded ? commentBody : commentBody.slice(0, maxLength) + "…";
        return (Devvit.createElement("vstack", { height: "100%", width: "100%", gap: "small", alignment: "center middle", borderColor: "green", border: "thick", padding: "medium" },
            Devvit.createElement("text", { size: "large", weight: "bold" }, "Verified Solution"),
            Devvit.createElement("text", null, displayBody),
            isLong && Devvit.createElement("button", { appearance: "subtle", onPress: () => setExpanded(!expanded) }, expanded ? "Show less" : "Show more"),
            permalink && (Devvit.createElement("button", { appearance: "primary", onPress: () => context.ui.navigateTo(permalink) }, "Go to answer"))));
    },
});
export default Devvit;
