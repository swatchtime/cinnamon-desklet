const Gio = imports.gi.Gio;
const St = imports.gi.St;
const Desklet = imports.ui.desklet;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;
const Settings = imports.ui.settings;
const Cinnamon = imports.gi.Cinnamon;
const Lang = imports.lang;
const Main = imports.ui.main;
const Clutter = imports.gi.Clutter;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Cogl = imports.gi.Cogl;

const UUID = "swatchtime@kdawson";
const DESKLET_ROOT = imports.ui.deskletManager.deskletMeta[UUID].path;


function MyDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
        this.metadata = metadata;
        this.deskletDir = GLib.get_home_dir() + '/.local/share/cinnamon/desklets/' + metadata.uuid;

        // default settings
        this.settings = {
            showCentibeats: true,
            showLogo: true,
            bgColor: '#000000',
            bgOpacity: 0.3,
            fontColor: '#FFFFFF',
            fontSize: 36
        };

        // Prefer GSettings (native) when available. Otherwise fall back to file-based settings.
        this.gsettings = null;
        try {
            this.gsettings = new Gio.Settings({ schema_id: 'org.cinnamon.desklets.swatchtime' });
            this.settings.showCentibeats = this.gsettings.get_boolean('show-centibeats');
            this.settings.showLogo = this.gsettings.get_boolean('show-logo');
            this.settings.bgColor = this.gsettings.get_string('bg-color');
            this.settings.bgOpacity = this.gsettings.get_double('bg-opacity');
            this.settings.fontColor = this.gsettings.get_string('font-color');
            this.settings.fontSize = this.gsettings.get_int('font-size');
            this.gsettings.connect('changed', (settings, key) => { this._onGSettingsChanged(key); });
        } catch (e) {
            this.gsettings = null;
            this._loadSettings();
        }

        this.setupUI();
        this._startTimer();
    },

    setupUI: function() {
        // outer container
        this.container = new St.Bin({ reactive: true });

        // background box with padding and rounded style via inline CSS
        this.bg = new St.BoxLayout({ style_class: 'swatch-bg', vertical: false });

        // flag icon (load from desklet folder)
        this.flag = null;
        if (this.settings.showLogo) {
            try {
                let flagPath = this.deskletDir + '/icon.png';
                let file = Gio.file_new_for_path(flagPath);
                if (file.query_exists(null)) {
                    let gicon = new Gio.FileIcon({ file: file });
                    this.flag = new St.Icon({ gicon: gicon, icon_size: Math.round(this.settings.fontSize * 0.9) });
                }
            } catch (e) {}
        }

        // label for swatch beats
        this.label = new St.Label({ text: '@000', style_class: 'swatch-label' });

        // center alignment container (avoid name collision with Desklet.content)
        this.inner = new St.BoxLayout({ style_class: 'swatch-content', vertical: false, x_align: St.Align.MIDDLE });
        if (this.flag) this.inner.add_actor(this.flag);
        this.inner.add_actor(this.label);

        this.bg.add_actor(this.inner);

        // now that label and content exist, apply styles
        this._applyStyles();

        // pack bg into container (no in-desklet gear; use native Desklets manager settings)
        this.wrapper = new St.BoxLayout({ vertical: false });
        this.wrapper.add_actor(this.bg);
        this.container.add_actor(this.wrapper);
        this.setContent(this.container);

    },

    /* settings panel removed - using GSettings / manager preferences */

    // settings panel removed - native manager (GSettings) provides preferences

    _applyStyles: function() {
        if (!this.label) {
            return;
        }

        // Make outer container and wrapper transparent so only the pill shows
        try {
            this.container.set_style('background: transparent; padding: 0;');
            if (this.wrapper) this.wrapper.set_style('background: transparent; padding: 0; align-items: center;');
        } catch (e) {}

        // Inline style for the pill background (color + opacity + rounded corners + padding + shadow)
        const rgba = this._hexToRgba(this.settings.bgColor, this.settings.bgOpacity);
        const pillStyle = 'background-color: ' + rgba + '; border-radius: 40px; padding: 8px 20px; box-shadow: 0 8px 20px rgba(0,0,0,0.6); display: flex; align-items: center;';
        this.bg.set_style(pillStyle);

        // label style (font size + color)
        this.label.set_style('color: ' + this.settings.fontColor + '; font-size: ' + Math.round(this.settings.fontSize) + 'px; font-weight: 400; margin-left: 12px; margin-right: 12px;');

        // No in-desklet gear styling (native manager will provide settings UI)
    },

    _startTimer: function() {
        if (this._timeout) Mainloop.source_remove(this._timeout);
        this._update();
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

    /* popup menu removed - use native preferences via GSettings */

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
        } catch (e) {}
    },

    _saveSettings: function() {
        try {
            if (this.gsettings) {
                this.gsettings.set_boolean('show-centibeats', !!this.settings.showCentibeats);
                this.gsettings.set_boolean('show-logo', !!this.settings.showLogo);
                this.gsettings.set_string('bg-color', String(this.settings.bgColor));
                this.gsettings.set_double('bg-opacity', Number(this.settings.bgOpacity));
                this.gsettings.set_string('font-color', String(this.settings.fontColor));
                this.gsettings.set_int('font-size', Number(this.settings.fontSize));
            } else {
                let data = JSON.stringify(this.settings);
                GLib.file_set_contents(this._getSettingsPath(), data);
            }
        } catch (e) {}
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
        if (this.flag) this.inner.remove_actor(this.flag);
        this.flag = null;
        if (this.settings.showLogo) {
                try {
                let flagPath = this.deskletDir + '/icon.png';
                let file = Gio.file_new_for_path(flagPath);
                if (file.query_exists(null)) {
                    let gicon = new Gio.FileIcon({ file: file });
                    this.flag = new St.Icon({ gicon: gicon, icon_size: Math.round(this.settings.fontSize * 0.9) });
                    this.inner.insert_actor(this.flag, 0);
                }
            } catch (e) {}
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

    _onGSettingsChanged: function(key) {
        try {
            if (!this.gsettings) return;
            switch (key) {
                case 'show-centibeats':
                    this.settings.showCentibeats = this.gsettings.get_boolean('show-centibeats');
                    break;
                case 'show-logo':
                    this.settings.showLogo = this.gsettings.get_boolean('show-logo');
                    if (this.settings.showLogo && !this.flag) {
                        try {
                            let flagPath = this.deskletDir + '/icon.png';
                            let file = Gio.file_new_for_path(flagPath);
                            if (file.query_exists(null)) {
                                let gicon = new Gio.FileIcon({ file: file });
                                this.flag = new St.Icon({ gicon: gicon, icon_size: Math.round(this.settings.fontSize * 0.9) });
                                this.inner.insert_actor(this.flag, 0);
                            }
                        } catch (e) {}
                    } else if (!this.settings.showLogo && this.flag) {
                        this.inner.remove_actor(this.flag);
                        this.flag = null;
                    }
                    break;
                case 'bg-color':
                    this.settings.bgColor = this.gsettings.get_string('bg-color');
                    break;
                case 'bg-opacity':
                    this.settings.bgOpacity = this.gsettings.get_double('bg-opacity');
                    break;
                case 'font-color':
                    this.settings.fontColor = this.gsettings.get_string('font-color');
                    break;
                case 'font-size':
                    this.settings.fontSize = this.gsettings.get_int('font-size');
                    if (this.flag) this.flag.set_icon_size(Math.round(this.settings.fontSize * 0.9));
                    break;
            }
            this._applyStyles();
            this._update();
        } catch (e) {}
    },

    on_desklet_removed: function() {
        if (this._timeout) Mainloop.source_remove(this._timeout);
    }
};

function main(metadata, desklet_id) {
    return new MyDesklet(metadata, desklet_id);
}