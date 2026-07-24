import { test, expect, describe } from "bun:test";
import { computeTextDiff } from "@outrival/shared";
import {
  findYouTubeChannelUrl,
  channelIdFromUrl,
  extractChannelId,
  isYouTubeUrl,
  channelFeedUrl,
  parseChannelFeed,
  buildYouTubeDoc,
} from "./youtube";
import { collectVideos, resolveChannelId } from "./youtube.scraper";
import { extractContent } from "../lib/extract-content";

const CHANNEL_ID = "UCabcdefghijklmnopqrst01"; // "UC" + 22 url-safe chars

// A trimmed YouTube channel videos.xml (Atom), the exact shape the OFFICIAL feed
// returns: channel-level <yt:channelId>, per-video <yt:videoId>, <link
// rel="alternate">, <published>. Newest entry is NOT first, to prove sorting.
const YT_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <link rel="alternate" href="https://www.youtube.com/channel/${CHANNEL_ID}"/>
  <id>yt:channel:${CHANNEL_ID}</id>
  <yt:channelId>${CHANNEL_ID}</yt:channelId>
  <title>Acme</title>
  <entry>
    <id>yt:video:VID2older</id>
    <yt:videoId>VID2older</yt:videoId>
    <title>Acme weekly standup</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=VID2older"/>
    <published>2026-06-20T10:00:00+00:00</published>
    <updated>2026-06-20T10:30:00+00:00</updated>
  </entry>
  <entry>
    <id>yt:video:VID1newer</id>
    <yt:videoId>VID1newer</yt:videoId>
    <title>Acme launches AI copilot</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=VID1newer"/>
    <published>2026-07-05T14:00:00+00:00</published>
    <updated>2026-07-05T15:00:00+00:00</updated>
  </entry>
</feed>`;

describe("(a) channel id resolution → official feed url", () => {
  test("inline id is read straight off a /channel/UC… url", () => {
    expect(channelIdFromUrl(`https://www.youtube.com/channel/${CHANNEL_ID}`)).toBe(CHANNEL_ID);
    expect(channelIdFromUrl("https://www.youtube.com/@acme")).toBeNull();
  });

  test("finds the channel link on a homepage footer (skips a video link)", () => {
    const homepage = `<html><body><footer>
      <a href="https://twitter.com/acme">X</a>
      <a href="https://www.youtube.com/watch?v=promoClip">Watch our promo</a>
      <a href="https://www.youtube.com/@acme">YouTube</a>
    </footer></body></html>`;
    expect(findYouTubeChannelUrl(homepage, "https://acme.com")).toBe("https://www.youtube.com/@acme");
  });

  test("prefers a /channel/ link over a handle when both are present", () => {
    const homepage = `<a href="https://www.youtube.com/@acme"></a>
      <a href="https://www.youtube.com/channel/${CHANNEL_ID}"></a>`;
    expect(findYouTubeChannelUrl(homepage, "https://acme.com")).toBe(
      `https://www.youtube.com/channel/${CHANNEL_ID}`,
    );
  });

  test("pulls the id out of a fetched handle channel page (canonical link)", () => {
    const channelPage = `<html><head>
      <link rel="canonical" href="https://www.youtube.com/channel/${CHANNEL_ID}">
      <meta property="og:url" content="https://www.youtube.com/@acme"></head></html>`;
    expect(extractChannelId(channelPage)).toBe(CHANNEL_ID);
  });

  test("channelFeedUrl builds the official videos.xml endpoint", () => {
    expect(channelFeedUrl(CHANNEL_ID)).toBe(
      `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`,
    );
  });

  test("resolveChannelId: homepage handle → channel page → id (two fetches)", async () => {
    const fetched: string[] = [];
    const fetchText = async (url: string) => {
      fetched.push(url);
      if (url === "https://acme.com")
        return `<footer><a href="https://www.youtube.com/@acme">YT</a></footer>`;
      if (url === "https://www.youtube.com/@acme")
        return `<link rel="canonical" href="https://www.youtube.com/channel/${CHANNEL_ID}">`;
      return null;
    };
    expect(await resolveChannelId("https://acme.com", { fetchText })).toBe(CHANNEL_ID);
    expect(fetched).toEqual(["https://acme.com", "https://www.youtube.com/@acme"]);
  });

  test("parseChannelFeed → normalized videos, sorted newest-first", () => {
    const videos = parseChannelFeed(YT_FEED);
    expect(videos.map((v) => v.id)).toEqual(["yt:video:VID1newer", "yt:video:VID2older"]);
    expect(videos[0]).toMatchObject({
      title: "Acme launches AI copilot",
      link: "https://www.youtube.com/watch?v=VID1newer",
      publishedAt: "2026-07-05T14:00:00.000Z",
    });
  });

  test("collectVideos: homepage /channel/ link → feed → sorted videos (one hop, id inline)", async () => {
    const fetchText = async (url: string) => {
      if (url === "https://acme.com")
        return `<a href="https://www.youtube.com/channel/${CHANNEL_ID}">YT</a>`;
      if (url === channelFeedUrl(CHANNEL_ID)) return YT_FEED;
      return null;
    };
    const { channelId, videos } = await collectVideos("https://acme.com", { fetchText });
    expect(channelId).toBe(CHANNEL_ID);
    expect(videos).toHaveLength(2);
  });

  test("throws (never an empty snapshot) when the homepage links no channel", async () => {
    const fetchText = async () => "<footer>no socials here</footer>";
    await expect(collectVideos("https://acme.com", { fetchText })).rejects.toThrow("no_channel");
  });
});

describe("buildYouTubeDoc — deterministic snapshot + generic diff surfaces a new video", () => {
  const before = parseChannelFeed(YT_FEED);

  test("is order-independent (stable content hash)", () => {
    const a = buildYouTubeDoc(CHANNEL_ID, before);
    const b = buildYouTubeDoc(CHANNEL_ID, [...before].reverse());
    expect(a.html).toBe(b.html);
    expect(a.text).toBe(b.text);
  });

  test("(b) the production diff path surfaces a genuinely new video only", () => {
    const withNew = [
      ...before,
      {
        id: "yt:video:VID3new",
        title: "Acme ships enterprise SSO",
        link: "https://www.youtube.com/watch?v=VID3new",
        publishedAt: "2026-07-10T09:00:00.000Z",
        summary: null,
      },
    ];
    const beforeDoc = buildYouTubeDoc(CHANNEL_ID, before);
    const afterDoc = buildYouTubeDoc(CHANNEL_ID, withNew);

    // Exactly the pipeline's diff path: extractContent → computeTextDiff.
    const diff = computeTextDiff(
      extractContent(beforeDoc.html, "youtube"),
      extractContent(afterDoc.html, "youtube"),
    );
    expect(diff.hasChanges).toBe(true);
    const added = diff.added.join("\n");
    expect(added).toContain("Acme ships enterprise SSO"); // the new video shows up
    expect(added).not.toContain("Acme launches AI copilot"); // an unchanged one does not
  });
});

// A competitor with no YouTube link on their site reads as "no such surface". The
// user can overrule that by pinning the channel, which only works if the resolver
// stops treating its input as a page to go hunting on.
describe("a pinned channel URL is the answer, not a page to search", () => {
  test("recognises YouTube hosts and nothing else", () => {
    expect(isYouTubeUrl("https://www.youtube.com/@acme")).toBe(true);
    expect(isYouTubeUrl("https://youtube.com/channel/UC1234567890123456789012")).toBe(true);
    expect(isYouTubeUrl("https://m.youtube.com/@acme")).toBe(true);
    expect(isYouTubeUrl("https://youtu.be/abc")).toBe(true);
    // A competitor site that merely mentions youtube is still their site.
    expect(isYouTubeUrl("https://acme.com/youtube.com")).toBe(false);
    expect(isYouTubeUrl("https://notyoutube.com")).toBe(false);
    expect(isYouTubeUrl("not a url")).toBe(false);
  });

  test("an inline channel id resolves with zero fetches", async () => {
    let fetches = 0;
    const id = await resolveChannelId("https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv", {
      fetchText: async () => {
        fetches++;
        return null;
      },
    });
    expect(id).toBe("UCabcdefghijklmnopqrstuv");
    expect(fetches).toBe(0);
  });

  test("a handle URL is fetched directly, never scanned for a link to itself", async () => {
    const seen: string[] = [];
    const id = await resolveChannelId("https://www.youtube.com/@acme", {
      fetchText: async (url) => {
        seen.push(url);
        return '<link rel="canonical" href="https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv">';
      },
    });
    expect(id).toBe("UCabcdefghijklmnopqrstuv");
    // Exactly one fetch, of the pinned URL itself.
    expect(seen).toEqual(["https://www.youtube.com/@acme"]);
  });

  test("the homepage path is untouched: still discovers via a link on their site", async () => {
    const id = await resolveChannelId("https://acme.com", {
      fetchText: async (url) =>
        url === "https://acme.com"
          ? '<a href="https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv">YouTube</a>'
          : null,
    });
    expect(id).toBe("UCabcdefghijklmnopqrstuv");
  });

  test("a pinned URL that resolves to nothing still reports no channel", async () => {
    await expect(
      collectVideos("https://www.youtube.com/@ghost", { fetchText: async () => null }),
    ).rejects.toThrow("no_channel");
  });
});
