export const worksData = [
    {
        id: 'cloth-paper',
        title: 'Cloth & Paper',
        year: 2024,
        month: 'October',
        type: 'album',
        tags: ['album'],
        spotify: {
            type: 'album',
            id: '3V0SYJeAZo3Sklm7J2aU0P'
        },
        appleMusic: {
            type: 'album',
            id: '1772370903'
        },
        tidal: {
            type: 'album',
            id: '391151793' // Add Tidal album ID
        },
        youtubeMusic: {
            type: 'playlist',
            id: 'OLAK5uy_mCmDYLMo2C5cmACnR81Y_GFNZ1KYLkO_s' // Add YouTube Music playlist ID
        },
        description: 'Third studio album',
        coverArt: '/cloth_and_paper_cover.png',
        expandedByDefault: false
    },
    {
        id: 'edges',
        title: 'Edges',
        year: 2021,
        month: 'December',
        type: 'album',
        tags: ['album'],
        spotify: {
            type: 'album',
            id: '3gSd7F4xLmb7rNPY4sYAeX'
        },
        appleMusic: {
            type: 'album',
            id: '1600107858'
        },
        tidal: {
            type: 'album',
            id: '208976912' // Add Tidal album ID
        },
        youtubeMusic: {
            type: 'playlist',
            id: 'OLAK5uy_m8PD7rJOsfFDzWGaoop2c7rx13q6gL34U' // Add YouTube Music playlist ID
        },
        description: 'Second studio album',
        coverArt: '/edges.jpeg',
        expandedByDefault: false
    },
    {
        id: 'say-yes',
        title: 'Say Yes',
        year: 2019,
        month: 'April',
        type: 'album',
        tags: ['album'],
        spotify: {
            type: 'album',
            id: '1TCSHdADqO8MJBdoY7L0eq'
        },
        appleMusic: {
            type: 'album',
            id: '1459008594'
        },
        tidal: {
            type: 'album',
            id: '107247202' // Add Tidal album ID
        },
        youtubeMusic: {
            type: 'playlist',
            id: 'OLAK5uy_kuy-1J6mK2u-yH1HMoYzVB3a2-8yeaSWU' // Add YouTube Music playlist ID
        },
        description: 'First studio album',
        coverArt: '/say_yes.jpg',
        expandedByDefault: false
    },
    {
        id: 'miles-217',
        title: 'Yehezkel Raz - (217) Miles - Rework',
        year: 2023,
        month: null,
        type: 'collaboration',
        tags: ['collaboration'],
        description: 'Rework of (217) Miles by Yehezkel Raz. Featured in the album Re: There is no time (Remixes)',
        spotify: {
            type: 'track',
            id: '3Dc1nHQQ1ex3AnBaZi5qTn'
        },
        appleMusic: {
            type: 'song',
            id: '1722917434'
        },
        tidal: {
            type: 'track',
            id: '336984880' // Add Tidal track ID
        },
        youtubeMusic: {
            type: 'video',
            id: 'CGVAEkohKC4' // Add YouTube video ID
        },
        coverArt: '/there_is_no_time.jpeg',
        expandedByDefault: false
    },
    {
        id: 'sheva-7',
        title: 'Yehezkel Raz - Sheva (7) - Rework',
        year: 2023,
        month: null,
        type: 'collaboration',
        tags: ['collaboration'],
        description: 'Rework of Sheva (7) by Yehezkel Raz. Featured in the album Re: There is no time (Remixes)',
        spotify: {
            type: 'track',
            id: '0maqBvR7b1NZWeTCo2CEnZ'
        },
        appleMusic: {
            type: 'song',
            id: '1722917435'
        },
        tidal: {
            type: 'track',
            id: '336984881' // Add Tidal track ID
        },
        youtubeMusic: {
            type: 'video',
            id: 'ycP13x8OyeU' // Add YouTube video ID
        },
        coverArt: '/there_is_no_time.jpeg',
        expandedByDefault: false
    },
    {
        id: 'take-off',
        title: 'Take Off',
        year: 2025,
        month: 'August',
        type: 'collaboration',
        tags: ['collaboration', 'soundtrack', 'performance'],
        description: 'Soundtrack desgin and original score for Hani Sirkis\'s performance at Suzanne Dellal Center, Tel Aviv',
        longDescription: 'A dance performance exploring identity and transformation through drag, tracing a character shedding layers step by step. Created and performed by Hani Sirkis (aka Barbie Cute).',
        platforms: {
            youtube: {
                id: null // Add if performance video is available
            },
            vimeo: {
                id: null
            }
        },
        performanceImages: [
            '/takeoff2.jpeg',
            '/takeoff3.jpg'
        ],
        coverArt: '/takeoff1.jpeg',
        expandedByDefault: false
    },
    {
        id: 'mc.lot',
        title: 'mc.lot', // You can update this
        year: 2025, // Update with actual year
        month: 'April', // Update if you want
        type: 'audiovisual',
        tags: ['audiovisual', 'a/v'],
        description: null, // Add description if you want
        platforms: {
            youtube: {
                id: 'RVscjlZVHlg',
                startTime: 7 // Optional start time in seconds
            },
            vimeo: {
                id: null // Add Vimeo ID if available
            }
        },
        coverArt: '/mc.lot.jpg',
        expandedByDefault: true // A/V work expanded by default
    },
    {
        id: 'rit-to-all',
        title: 'Rit to All',
        year: 2025,
        month: 'August',
        type: 'performance',
        tags: ['collaboration', 'performance', 'audiovisual'],
        description: 'A curated evening of audiovisual and live performance, co-curated and performed',
        longDescription: 'A multidisciplinary performance evening bringing together audiovisual art, installation and dance, featuring performances by <a href="https://yehezkelraz.com/" target="_blank">Yehezkel Raz</a>, Lia Dreyfus, <a href="https://giladashery.com/" target="_blank">Gilad Ashery</a>, Daniel Gazit, Maya Navot, Ofir Kunesh, and more.',
        performanceImages: [
            '/rit-to-all-daniel-1.jpg',
            '/rit-to-all-daniel-2.jpg',
            '/rit-to-all-daniel-3.jpg',
            '/rit-to-all-lia.jpg',
            '/rit-to-all-maya.jpg',
            '/rit-to-all-yehezkel.jpg'
        ],
        coverArt: '/rit-to-all-daniel-1.jpg',
        expandedByDefault: false
    }
];
 
