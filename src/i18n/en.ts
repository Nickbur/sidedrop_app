export const en = {
    brand: 'Sidedrop',
    by: 'by burakov',
    tagline: 'Real-time file transfer, device to device. No cloud. No storage. No account.',
    lang: { switch: 'Русский', label: 'EN' },
    theme: { toggle: 'Toggle theme' },

    conn: {
        connecting: 'Connecting…',
        waiting: 'Waiting for the other device…',
        connected: 'Connected',
        reconnecting: 'Reconnecting…',
        closed: 'Disconnected',
        peerLeft: 'The other device left.',
        roomFull: 'This room is already full — Sidedrop connects one device to one.',
        notFound: 'That room or code was not found. Ask for a fresh one.',
        secure: 'End-to-end encrypted',
        relay: 'Relayed (TURN)',
        direct: 'Direct P2P',
        error: 'Connection error.',
        retry: 'Try again',
    },

    pair: {
        title: 'Open Sidedrop on your other device',
        subtitle: 'Scan the code, open the link, or type the code. Then just drop files — no confirmation needed.',
        scan: 'Scan to connect',
        link: 'Share link',
        codeLabel: 'Or enter this code',
        enterPrompt: 'Have a code?',
        enterPlaceholder: 'e.g. K7Q-2XM',
        join: 'Join',
        copy: 'Copy',
        copied: 'Copied',
        copyLink: 'Copy link',
        newRoom: 'New room',
    },

    drop: {
        title: 'Drop files or folders here',
        hint: 'or click to choose — they start sending immediately',
        files: 'Choose files',
        folder: 'Choose folder',
        text: 'Send text',
        disabledTitle: 'Connect a second device first',
        disabledHint: 'Files start sending as soon as the other device is connected.',
    },

    text: {
        title: 'Send text',
        placeholder: 'Type or paste text to send instantly…',
        send: 'Send',
        cancel: 'Cancel',
        received: 'Text',
        copy: 'Copy',
        copied: 'Copied',
    },

    table: {
        title: 'Transfers',
        empty: 'No transfers yet. Drop a file, folder, or text to start.',
        dir: '',
        name: 'Name',
        size: 'Size',
        progress: 'Progress',
        speed: 'Speed',
        eta: 'ETA',
        status: 'Status',
        actions: '',
        save: 'Save',
        saveAll: 'Save all',
        cancel: 'Cancel',
        remove: 'Clear',
        clearDone: 'Clear finished',
        sending: 'Sending',
        receiving: 'Receiving',
    },

    status: {
        queued: 'Queued',
        active: 'Transferring',
        paused: 'Reconnecting…',
        ready: 'Ready to save',
        done: 'Saved',
        completed: 'Received',
        failed: 'Failed',
        canceled: 'Canceled',
    },

    save: {
        pickerHint: 'Choose where to save.',
        downloadHint: 'Your browser will download it to its Downloads folder.',
        mobileWarn: 'Receiving large files on a phone may be limited by the browser — the desktop side handles big files best.',
        memoryWarn: 'This browser buffers incoming files in memory, so very large files may not fit. Chrome or Edge on desktop have no such limit.',
        failed: 'Could not save the file.',
    },

    landing: {
        how: {
            title: 'How it works',
            body: 'Open Sidedrop on two devices, pair them with the code or QR, and drop files. Bytes stream directly between the browsers over an encrypted peer-to-peer channel.',
        },
        priv: {
            title: 'Private by design',
            body: 'Files never touch a server and are never stored. The connection is end-to-end encrypted; a relay, when the network forces one, only forwards data it cannot read.',
        },
        oss: {
            title: 'Free & open source',
            body: 'No account, no ads, no size limits. Read the code, star it, or contribute on GitHub.',
        },
    },

    footer: {
        tagline: 'A burakov project.',
        site: 'burakov.net',
        source: 'Source',
        sponsor: 'Sponsor',
    },

    units: {
        perSecond: '{value}/s',
    },
};

export type Messages = typeof en;
