const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const PopupMenu = imports.ui.popupMenu;

// Write a small debug entry immediately when this file is evaluated so
// we can confirm which copy Cinnamon actually loads (writes debug.txt).
try {
    const _dbgDir = GLib.get_home_dir() + '/.local/share/cinnamon/desklets/swatchtime@kdawson';
    const _dbgPath = _dbgDir + '/debug.txt';
    let now = (new Date()).toISOString();
    try {
        let [ok, contents] = GLib.file_get_contents(_dbgPath);
        if (!ok) contents = '';
        contents = contents + now + ' - file evaluated\n';
        GLib.file_set_contents(_dbgPath, contents);
    } catch (e) {
        // if reading failed, just write new file
        GLib.file_set_contents(_dbgPath, now + ' - file evaluated\n');
    }
} catch (e) {
    log('swatchtime: debug write failed at top-level: ' + e);
}

function MyDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
        log('swatchtime: _init called for ' + metadata.uuid + ' id=' + desklet_id);
        this.metadata = metadata;
        this.deskletDir = GLib.get_home_dir() + '/.local/share/cinnamon/desklets/' + metadata.uuid;

        // default settings
        this.settings = {
            showCentibeats: true,
            showLogo: true,
            bgColor: '#000000',
            bgOpacity: 0.6,
            fontColor: '#FFFFFF',
            fontSize: 64
        };

        this._loadSettings();
        log('swatchtime: settings after load: ' + JSON.stringify(this.settings));
        this.setupUI();
        log('swatchtime: setupUI completed');
        this._startTimer();
    },

    setupUI: function() {
        log('swatchtime: setupUI starting');
        // outer container
        this.container = new St.Bin({ reactive: true });

        // background box with padding and rounded style via inline CSS
        this.bg = new St.BoxLayout({ style_class: 'swatch-bg', vertical: false });

        // flag icon (load from desklet folder)
        this.flag = null;
        if (this.settings.showLogo) {
            try {
                let flagPath = this.deskletDir + '/swiss-flag.png';
                let file = Gio.file_new_for_path(flagPath);
                if (file.query_exists(null)) {
                    let gicon = new Gio.FileIcon({ file: file });
                    this.flag = new St.Icon({ gicon: gicon, icon_size: Math.round(this.settings.fontSize * 0.9) });
                }
            } catch (e) {
                log('Swatch desklet: failed to load flag: ' + e);
            }
        }

        // label for swatch beats
        this.label = new St.Label({ text: '@000', style_class: 'swatch-label' });

        // center alignment container
        this.content = new St.BoxLayout({ style_class: 'swatch-content', vertical: false, x_align: St.Align.MIDDLE });
        if (this.flag) this.content.add_actor(this.flag);
        this.content.add_actor(this.label);

        this.bg.add_actor(this.content);

        // now that label and content exist, apply styles
        this._applyStyles();

        // gear button to open settings menu (in-desklet)
        this.gearButton = new St.Button({ style_class: 'swatch-gear' });
        this.gearIcon = new St.Label({ text: '⚙', style_class: 'swatch-gear-icon' });
        this.gearButton.set_child(this.gearIcon);
        this.gearButton.connect('button-press-event', () => { this._openSettingsMenu(); });

        // pack bg and gear into container
        let wrapper = new St.BoxLayout({ vertical: false });
        wrapper.add_actor(this.bg);
        wrapper.add_actor(this.gearButton);

        this.container.add_actor(wrapper);
        this.setContent(this.container);

        // create popup menu (re-usable)
        this.menu = new PopupMenu.PopupMenu(this.container, 0.0, St.Side.TOP);
        this.menuManagerAdd = imports.ui.main.panel ? null : null; // keep reference to avoid GC in some Cinnamon versions
        log('swatchtime: popup menu created');
    },

    _applyStyles: function() {
        if (!this.label) {
            log('swatchtime: _applyStyles called but this.label is not set yet; skipping');
            return;
        }
        // Inline style for background (color + opacity + rounded corners + padding)
        const rgba = this._hexToRgba(this.settings.bgColor, this.settings.bgOpacity);
        this.bg.set_style('background-color: ' + rgba + '; border-radius: 40px; padding: 12px 24px;');

        // label style
        this.label.set_style('color: ' + this.settings.fontColor + '; font-size: ' + Math.round(this.settings.fontSize) + 'px; font-weight: 400; padding-left: 12px; padding-right: 12px;');
    },

    _startTimer: function() {
        if (this._timeout) Mainloop.source_remove(this._timeout);
        this._update();
        log('swatchtime: starting timer');
        // update every 1 second
        this._timeout = Mainloop.timeout_add_seconds(1, () => {
            this._update();
            return true; // repeat
        });
    },

    _update: function() {
        const beats = this._calculateSwatchTime(new Date());
        let text = this.settings.showCentibeats ? `@${beats.toFixed(2)}` : `@${Math.floor(beats)}`;
        if (this.label && typeof this.label.set_text === 'function') {
            this.label.set_text(text);
            log('swatchtime: _update set text=' + text);
        } else {
            log('swatchtime: _update skipped because label is not available yet; computed text=' + text);
        }
        return true;
    },

    _calculateSwatchTime: function(date) {
        // Calculate beats using Biel Mean Time (UTC+1)
        const utcHours = date.getUTCHours();
        const utcMinutes = date.getUTCMinutes();
        const utcSeconds = date.getUTCSeconds();
        const utcMilliseconds = date.getUTCMilliseconds();

        // Convert to BMT (UTC+1)
        const bmtHours = (utcHours + 1) % 24;

        // total seconds since midnight BMT
        const totalSeconds = (bmtHours * 3600) + (utcMinutes * 60) + utcSeconds + (utcMilliseconds / 1000);

        const beats = (totalSeconds / 86.4) % 1000; // 86400 / 1000 = 86.4
        return beats;
    },

    _openSettingsMenu: function() {
        // Clear existing menu items
        this.menu.removeAll();

        let item1 = new PopupMenu.PopupMenuItem(this.settings.showCentibeats ? 'Disable centibeats' : 'Enable centibeats');
        item1.connect('activate', () => { this.settings.showCentibeats = !this.settings.showCentibeats; this._saveSettings(); this._applyStyles(); this._update(); });
        this.menu.addMenuItem(item1);

        let item2 = new PopupMenu.PopupMenuItem(this.settings.showLogo ? 'Hide logo' : 'Show logo');
        item2.connect('activate', () => {
            this.settings.showLogo = !this.settings.showLogo;
            if (this.settings.showLogo && !this.flag) {
                try {
                    let flagPath = this.deskletDir + '/swiss-flag.png';
                    let file = Gio.file_new_for_path(flagPath);
                    if (file.query_exists(null)) {
                        let gicon = new Gio.FileIcon({ file: file });
                        this.flag = new St.Icon({ gicon: gicon, icon_size: Math.round(this.settings.fontSize * 0.9) });
                        this.content.insert_actor(this.flag, 0);
                    }
                } catch (e) { log('swatch: failed to re-add flag: ' + e); }
            } else if (!this.settings.showLogo && this.flag) {
                this.content.remove_actor(this.flag);
                this.flag = null;
            }
            this._saveSettings();
        });
        this.menu.addMenuItem(item2);

        // Quick background opacity stepper
        let opItem = new PopupMenu.PopupMenuItem('Toggle opacity (cycle)');
        opItem.connect('activate', () => {
            const steps = [0.2, 0.4, 0.6, 0.8, 1.0];
            let i = steps.indexOf(this.settings.bgOpacity);
            i = (i + 1) % steps.length;
            this.settings.bgOpacity = steps[i];
            this._saveSettings();
            this._applyStyles();
        });
        this.menu.addMenuItem(opItem);

        let fontItem = new PopupMenu.PopupMenuItem('Cycle font size');
        fontItem.connect('activate', () => {
            const sizes = [36, 48, 64, 80];
            let i = sizes.indexOf(this.settings.fontSize);
            if (i === -1) i = 0; else i = (i + 1) % sizes.length;
            this.settings.fontSize = sizes[i];
            if (this.flag) this.flag.set_icon_size(Math.round(this.settings.fontSize * 0.9));
            this._saveSettings();
            this._applyStyles();
        });
        this.menu.addMenuItem(fontItem);

        let saveItem = new PopupMenu.PopupMenuItem('Reset to defaults');
        saveItem.connect('activate', () => { this._resetSettings(); });
        this.menu.addMenuItem(saveItem);

        this.menu.open();
    },

    _getSettingsPath: function() {
        return this.deskletDir + '/settings.json';
    },

    _loadSettings: function() {
        try {
            let [ok, contents] = GLib.file_get_contents(this._getSettingsPath());
            if (ok) {
                let parsed = JSON.parse(contents);
                for (let k in parsed) {
                    this.settings[k] = parsed[k];
                }
            }
        } catch (e) {
            log('swatchtime: _loadSettings error, using defaults: ' + e);
        }
    },

    _saveSettings: function() {
        try {
            let data = JSON.stringify(this.settings);
            GLib.file_set_contents(this._getSettingsPath(), data);
        } catch (e) {
            log('Swatch desklet: failed to save settings: ' + e);
        }
    },

    _resetSettings: function() {
        this.settings = {
            showCentibeats: true,
            showLogo: true,
            bgColor: '#000000',
            bgOpacity: 0.6,
            fontColor: '#FFFFFF',
            fontSize: 64
        };
        // rebuild UI minimally
        if (this.flag) this.content.remove_actor(this.flag);
        this.flag = null;
        if (this.settings.showLogo) {
            try {
                let flagPath = this.deskletDir + '/swiss-flag.png';
                let file = Gio.file_new_for_path(flagPath);
                if (file.query_exists(null)) {
                    let gicon = new Gio.FileIcon({ file: file });
                    this.flag = new St.Icon({ gicon: gicon, icon_size: Math.round(this.settings.fontSize * 0.9) });
                    this.content.insert_actor(this.flag, 0);
                }
            } catch (e) { log('swatch: reset error: ' + e); }
        }
        this._saveSettings();
        this._applyStyles();
    },

    _hexToRgba: function(hex, alpha) {
        let c = hex.replace('#', '');
        if (c.length === 3) c = c.split('').map(x => x + x).join('');
        const r = parseInt(c.substring(0,2), 16);
        const g = parseInt(c.substring(2,4), 16);
        const b = parseInt(c.substring(4,6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    },

    on_desklet_removed: function() {
        if (this._timeout) Mainloop.source_remove(this._timeout);
    }
};

function main(metadata, desklet_id) {
    return new MyDesklet(metadata, desklet_id);
}