// A stand-in Plex server for perf tests and benches: one movie section and one
// playlist holding every movie, with metadata shaped like a real server's
// (streams, chapters, markers, cast, artwork). It runs in a worker thread
// (see fakePlex.ts), so serving it costs the thread under measurement nothing.
//
// Plain JavaScript, so a worker can load it under vitest and tsx alike.
import http from 'node:http';
import { parentPort, workerData } from 'node:worker_threads';

const {
  movieCount,
  sectionId = 1,
  playlistId = '90001',
  host = '127.0.0.1',
} = workerData;

const Words = [
  'quiet',
  'river',
  'signal',
  'harbor',
  'winter',
  'engine',
  'paper',
  'orbit',
  'garden',
  'mirror',
  'static',
  'lantern',
];

function words(seed, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(Words[(seed * 7 + i * 3) % Words.length]);
  }
  return out.join(' ');
}

function movie(i) {
  const ratingKey = String(100_000 + i);
  const duration = 5_400_000 + (i % 60) * 60_000;
  const thumb = (kind) => `/library/metadata/${ratingKey}/${kind}/1700000000`;
  const person = (n, role) => ({
    id: 500_000 + n,
    tag: `Person ${n}`,
    role,
    thumb: `https://metadata-static.plex.tv/people/${n}.jpg`,
  });
  return {
    ratingKey,
    key: `/library/metadata/${ratingKey}`,
    guid: `plex://movie/5d776${ratingKey}`,
    Guid: [
      { id: `imdb://tt${1_000_000 + i}` },
      { id: `tmdb://${20_000 + i}` },
      { id: `tvdb://${30_000 + i}` },
    ],
    studio: `Studio ${i % 17}`,
    type: 'movie',
    title: `Bench Movie ${i}`,
    titleSort: `Bench Movie ${String(i).padStart(5, '0')}`,
    librarySectionTitle: 'Movies',
    librarySectionID: sectionId,
    librarySectionKey: `/library/sections/${sectionId}`,
    contentRating: 'PG-13',
    summary: `${words(i, 40)}. ${words(i + 1, 40)}.`,
    rating: 7.1,
    audienceRating: 6.8,
    year: 1990 + (i % 30),
    tagline: words(i, 8),
    thumb: thumb('thumb'),
    art: thumb('art'),
    duration,
    originallyAvailableAt: `${1990 + (i % 30)}-05-04`,
    addedAt: 1_600_000_000 + i,
    updatedAt: 1_700_000_000,
    audienceRatingImage: 'rottentomatoes://image.rating.upright',
    chapterSource: 'media',
    ratingImage: 'rottentomatoes://image.rating.ripe',
    Image: [
      { alt: `Bench Movie ${i}`, type: 'coverPoster', url: thumb('thumb') },
      { alt: `Bench Movie ${i}`, type: 'background', url: thumb('art') },
      { alt: `Bench Movie ${i}`, type: 'clearLogo', url: thumb('clearLogo') },
    ],
    Media: [
      {
        id: 200_000 + i,
        duration,
        bitrate: 9_850,
        width: 1920,
        height: 1080,
        aspectRatio: 1.78,
        audioChannels: 6,
        audioCodec: 'eac3',
        videoCodec: 'h264',
        videoResolution: '1080',
        container: 'mkv',
        videoFrameRate: '24p',
        videoProfile: 'high',
        Part: [
          {
            id: 300_000 + i,
            key: `/library/parts/${300_000 + i}/1700000000/file.mkv`,
            duration,
            file: `/media/movies/Bench Movie ${i} (${1990 + (i % 30)})/Bench Movie ${i}.mkv`,
            size: 6_500_000_000,
            container: 'mkv',
            videoProfile: 'high',
            Stream: [
              {
                id: 400_000 + i * 10,
                streamType: 1,
                default: true,
                codec: 'h264',
                index: 0,
                bitrate: 8_900,
                bitDepth: 8,
                chromaLocation: 'left',
                chromaSubsampling: '4:2:0',
                codedHeight: 1088,
                codedWidth: 1920,
                colorPrimaries: 'bt709',
                colorRange: 'tv',
                colorSpace: 'bt709',
                colorTrc: 'bt709',
                frameRate: 23.976,
                height: 1080,
                width: 1920,
                level: 41,
                profile: 'high',
                scanType: 'progressive',
                displayTitle: '1080p (H.264)',
                extendedDisplayTitle: '1080p (H.264)',
              },
              {
                id: 400_000 + i * 10 + 1,
                streamType: 2,
                selected: true,
                default: true,
                codec: 'eac3',
                index: 1,
                channels: 6,
                bitrate: 640,
                language: 'English',
                languageTag: 'en',
                languageCode: 'eng',
                audioChannelLayout: '5.1(side)',
                samplingRate: 48_000,
                displayTitle: 'English (EAC3 5.1)',
                extendedDisplayTitle: 'English (EAC3 5.1)',
              },
              {
                id: 400_000 + i * 10 + 2,
                streamType: 2,
                codec: 'aac',
                index: 2,
                channels: 2,
                bitrate: 192,
                language: 'Français',
                languageTag: 'fr',
                languageCode: 'fra',
                audioChannelLayout: 'stereo',
                samplingRate: 48_000,
                displayTitle: 'Français (AAC Stereo)',
                extendedDisplayTitle: 'Français (AAC Stereo)',
              },
              {
                id: 400_000 + i * 10 + 3,
                streamType: 3,
                codec: 'srt',
                index: 3,
                language: 'English',
                languageTag: 'en',
                languageCode: 'eng',
                displayTitle: 'English (SRT)',
                extendedDisplayTitle: 'English (SRT)',
              },
              {
                id: 400_000 + i * 10 + 4,
                streamType: 3,
                codec: 'pgs',
                index: 4,
                language: 'Español',
                languageTag: 'es',
                languageCode: 'spa',
                displayTitle: 'Español (PGS)',
                extendedDisplayTitle: 'Español (PGS)',
              },
            ],
          },
        ],
      },
    ],
    Genre: [{ tag: 'Drama' }, { tag: 'Comedy' }, { tag: 'Mystery' }],
    Country: [{ tag: 'United States of America' }],
    Director: [person(i % 50, undefined)],
    Writer: [person((i % 50) + 1, undefined), person((i % 50) + 2, undefined)],
    Role: Array.from({ length: 12 }, (_, n) =>
      person((i * 3 + n) % 400, `Character ${n}`),
    ),
    Marker: [
      { type: 'intro', startTimeOffset: 0, endTimeOffset: 60_000 },
      {
        type: 'credits',
        startTimeOffset: duration - 300_000,
        endTimeOffset: duration,
        final: true,
      },
    ],
    Chapter: Array.from({ length: 12 }, (_, n) => ({
      id: 600_000 + i * 20 + n,
      filter: `thumb=${n}`,
      index: n + 1,
      startTimeOffset: Math.floor((duration / 12) * n),
      endTimeOffset: Math.floor((duration / 12) * (n + 1)),
      thumb: `/library/media/${200_000 + i}/chapterImages/${n + 1}`,
    })),
  };
}

// Each movie's JSON, built once: the server only concatenates
const movieJson = new Map();
const order = [];
for (let i = 0; i < movieCount; i++) {
  const m = movie(i);
  movieJson.set(m.ratingKey, JSON.stringify(m));
  order.push(m.ratingKey);
}

function container(items, extra) {
  return (
    `{"MediaContainer":{"size":${items.length}${extra}` +
    `,"Metadata":[${items.join(',')}]}}`
  );
}

const sectionsJson = JSON.stringify({
  MediaContainer: {
    size: 1,
    Directory: [
      {
        allowSync: true,
        art: '/:/resources/movie-fanart.jpg',
        composite: `/library/sections/${sectionId}/composite/1700000000`,
        filters: true,
        refreshing: false,
        thumb: '/:/resources/movie.png',
        key: String(sectionId),
        type: 'movie',
        title: 'Movies',
        agent: 'tv.plex.agents.movie',
        scanner: 'Plex Movie',
        language: 'en-US',
        uuid: 'bench-section-uuid',
        updatedAt: 1_700_000_000,
        createdAt: 1_600_000_000,
        scannedAt: 1_700_000_000,
        content: true,
        directory: true,
        contentChangedAt: 1,
        hidden: 0,
        Location: [{ id: 1, path: '/media/movies' }],
      },
    ],
  },
});

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://plex');
  const path = url.pathname;

  if (path === `/playlists/${playlistId}/items`) {
    const start = Number(url.searchParams.get('X-Plex-Container-Start') ?? 0);
    const size = Number(url.searchParams.get('X-Plex-Container-Size') ?? 50);
    const page = order
      .slice(start, start + size)
      .map((key) => movieJson.get(key));
    return send(res, 200, container(page, `,"totalSize":${order.length}`));
  }

  const metadata = path.match(/^\/library\/metadata\/(\d+)$/);
  if (metadata) {
    const json = movieJson.get(metadata[1]);
    if (json === undefined) {
      return send(res, 404, '{}');
    }
    return send(
      res,
      200,
      container([json], `,"librarySectionID":${sectionId}`),
    );
  }

  if (path === '/library/sections') {
    return send(res, 200, sectionsJson);
  }

  if (path === '/identity' || path === '/') {
    return send(
      res,
      200,
      JSON.stringify({
        MediaContainer: {
          size: 0,
          machineIdentifier: 'bench-plex',
          version: '1.40.0.0',
        },
      }),
    );
  }

  send(res, 404, '{}');
});

server.listen(0, host, () => {
  const address = server.address();
  parentPort.postMessage({
    type: 'listening',
    url: `http://${host}:${address.port}`,
  });
});

parentPort.on('message', (message) => {
  if (message === 'close') {
    server.closeAllConnections();
    server.close(() => process.exit(0));
  }
});
