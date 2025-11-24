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

        this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, desklet_id);
        this.settings.bind('show-centibeats', 'showCentibeats', this._onSettingsChanged);
        this.settings.bind('show-logo', 'showLogo', this._onSettingsChanged);
        this.settings.bind('bg-color', 'bgColor', this._onSettingsChanged);
        this.settings.bind('bg-opacity', 'bgOpacity', this._onSettingsChanged);
        this.settings.bind('font-color', 'fontColor', this._onSettingsChanged);
        this.settings.bind('font-size', 'fontSize', this._onSettingsChanged);

        this._onSettingsChanged();
        this.setupUI();
        this._startTimer();
    },

    setupUI: function() {
        // outer container
        this.container = new St.Bin({ reactive: true });

        // background box with padding and rounded style via inline CSS
        this.bg = new St.BoxLayout({ style_class: 'swatch-bg', vertical: false });

        // flag icon
        this.flag = null;
        if (this.showLogo) {
            try {
                let flagPath = DESKLET_ROOT + '/icon.png';
                let file = Gio.file_new_for_path(flagPath);
                if (file.query_exists(null)) {
                    let gicon = new Gio.FileIcon({ file: file });
                    this.flag = new St.Icon({ gicon: gicon, icon_size: Math.round(this.fontSize * 0.9) });
                }
            } catch (e) {}
        }

        // label for swatch beats
        this.label = new St.Label({ text: '@000', style_class: 'swatch-label' });

        // center alignment container
        this.inner = new St.BoxLayout({ style_class: 'swatch-content', vertical: false, x_align: St.Align.MIDDLE });
        if (this.flag) this.inner.add_actor(this.flag);
        this.inner.add_actor(this.label);

        this.bg.add_actor(this.inner);

        // now that label and content exist, apply styles
        this._applyStyles();

        this.wrapper = new St.BoxLayout({ vertical: false });
        this.wrapper.add_actor(this.bg);
        this.container.add_actor(this.wrapper);
        this.setContent(this.container);

    },

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
        const rgba = this._hexToRgba(this.bgColor, this.bgOpacity);
        const pillStyle = 'background-color: ' + rgba + '; border-radius: 40px; padding: 8px 20px; box-shadow: 0 8px 20px rgba(0,0,0,0.6); display: flex; align-items: center;';
        this.bg.set_style(pillStyle);

        // label style (font size + color)
        this.label.set_style('color: ' + this.fontColor + '; font-size: ' + Math.round(this.fontSize) + 'px; font-weight: 400; margin-left: 12px; margin-right: 12px;');

        // No in-desklet gear styling (native manager will provide settings UI)
    },

    _hexToRgba: function(hex, alpha) {
        // Remove # if present
        hex = hex.replace('#', '');
        // Parse r, g, b values
        let r = parseInt(hex.substring(0, 2), 16);
        let g = parseInt(hex.substring(2, 4), 16);
        let b = parseInt(hex.substring(4, 6), 16);
        // Return rgba string
        return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
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
        let text = this.showCentibeats ? `@${beats.toFixed(2)}` : `@${Math.floor(beats)}`;
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



    _onSettingsChanged: function() {
        // Handle logo show/hide
        if (this.showLogo && !this.flag) {
            try {
                let flagPath = DESKLET_ROOT + '/icon.png';
                let file = Gio.file_new_for_path(flagPath);
                if (file.query_exists(null)) {
                    let gicon = new Gio.FileIcon({ file: file });
                    this.flag = new St.Icon({ gicon: gicon, icon_size: Math.round(this.fontSize * 0.9) });
                    this.inner.insert_actor(this.flag, 0);
                }
            } catch (e) {}
        } else if (!this.showLogo && this.flag) {
            this.inner.remove_actor(this.flag);
            this.flag = null;
        }
        // Update icon size if font size changed
        if (this.flag) {
            this.flag.set_icon_size(Math.round(this.fontSize * 0.9));
        }
        this._applyStyles();
        this._update();
    },

    on_desklet_removed: function() {
        if (this._timeout) Mainloop.source_remove(this._timeout);
    }
};

function main(metadata, desklet_id) {
    return new MyDesklet(metadata, desklet_id);
}