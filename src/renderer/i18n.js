/* i18n.js: English is the key, German is looked up here. window.T(key, vars)
   fills {placeholders}. The language is set by app.js from the state. */
'use strict';

(function () {
  const DE = {
    'Home': 'Start', 'Games': 'Spiele', 'More': 'Mehr', 'Downloads': 'Downloads', 'Sources': 'Quellen', 'Settings': 'Einstellungen',
    'Game': 'Spiel', 'Mods': 'Mods', 'Modpacks': 'Modpacks', 'Refresh': 'Aktualisieren', 'Check for new mods': 'Nach neuen Mods sehen',
    'Catalog up to date': 'Katalog aktuell', 'Catalog not reachable': 'Katalog nicht erreichbar',
    'Offline, showing the list from {when}': 'Offline, Liste von {when}',
    'Checking the catalogs': 'Kataloge werden geprüft',
    'never': 'nie', 'just now': 'gerade eben', '{n} min ago': 'vor {n} Min.', '{n} h ago': 'vor {n} Std.',
    'up to date': 'aktuell', 'checking for updates': 'sucht nach Updates', 'development build': 'Entwicklungsstand',
    'Update {v} is downloading': 'Update {v} wird geladen', 'Update {v} is ready': 'Update {v} ist bereit', 'Restart and update': 'Neu starten und aktualisieren',

    'Mod launcher': 'Mod-Launcher',
    'Mods with one |click|.': 'Mods mit einem |Klick|.',
    'Pick a game, pick mods, press Launch. When you close the game, the mods are gone from the game folder again. Their settings and saved data stay here.':
      'Spiel wählen, Mods wählen, Starten drücken. Wenn du das Spiel schließt, sind die Mods wieder aus dem Spielordner verschwunden. Ihre Einstellungen und gespeicherten Daten bleiben hier.',
    'No catalog yet': 'Noch kein Katalog',
    'The mod list could not be loaded and there is no saved copy. Check your connection and press Refresh.':
      'Die Mod-Liste konnte nicht geladen werden und es gibt keine gespeicherte Kopie. Prüf deine Verbindung und drück auf Aktualisieren.',
    '{n} mod': '{n} Mod', '{n} mods': '{n} Mods', '{n} file': '{n} Datei', '{n} files': '{n} Dateien',
    'Coming later': 'Kommt später', 'Running': 'Läuft', 'Installed': 'Installiert', 'Not installed': 'Nicht installiert',
    'New in the catalog': 'Neu im Katalog', 'Your modpacks': 'Deine Modpacks',
    'New': 'Neu', 'Updated': 'Aktualisiert', 'Experimental': 'Experimentell', 'Beta': 'Beta',
    'Unofficial': 'Inoffiziell', 'Official': 'Offiziell', 'unofficial': 'inoffiziell', 'Optional': 'Optional',
    'From an unofficial source: {name}. Not checked by anyone.': 'Aus einer inoffiziellen Quelle: {name}. Von niemandem geprüft.',
    'Downloaded': 'Geladen', 'Update available': 'Update verfügbar',

    '{game} is being handled by the launcher': '{game} wird gerade vom Launcher betreut',
    'You can close this window. The launcher stays in the tray and puts the game folder back as soon as the game ends.':
      'Du kannst dieses Fenster schließen. Der Launcher bleibt im Tray und stellt den Spielordner wieder her, sobald das Spiel endet.',
    'Show': 'Anzeigen', 'OK': 'OK', 'Close': 'Schließen', 'Cancel': 'Abbrechen', 'Save': 'Speichern', 'Remove': 'Entfernen', 'Reset': 'Zurücksetzen', 'No': 'Nein',
    '{game}: cleaned up after an interrupted session': '{game}: nach einer abgebrochenen Sitzung aufgeräumt',
    '{game}: clean-up is still pending': '{game}: das Aufräumen steht noch aus',
    'The game folder is back to how it was before.': 'Der Spielordner ist wieder wie vorher.',
    'Found mod data from a manual install': 'Mod-Daten aus einer Installation von Hand gefunden',
    'Settings and saved data of these mods are already in your game folder. The launcher can copy them so they are there when you launch through it. Nothing in the game folder is changed.':
      'Einstellungen und gespeicherte Daten dieser Mods liegen schon in deinem Spielordner. Der Launcher kann sie kopieren, damit sie da sind, wenn du über ihn startest. Im Spielordner wird nichts verändert.',
    'Take over': 'Übernehmen', 'Copied into the launcher': 'In den Launcher kopiert',

    'Install the game through Steam first.': 'Installier das Spiel zuerst über Steam.',
    'Game folder': 'Spielordner', 'Steam was not found on this PC.': 'Steam wurde auf diesem PC nicht gefunden.',
    'Mods for {game}': 'Mods für {game}', 'Tick the ones you want': 'Hak an, was du willst', 'No mods for this game yet.': 'Für dieses Spiel gibt es noch keine Mods.',
    'Modpacks for {game}': 'Modpacks für {game}', 'Import code': 'Code einlösen', 'New pack': 'Neues Pack',
    'A modpack is a named set of mods you launch with one click and can share with friends as a code.':
      'Ein Modpack ist ein benanntes Set aus Mods, das du mit einem Klick startest und als Code mit Freunden teilen kannst.',
    'Share': 'Teilen', 'Edit': 'Bearbeiten', 'Launch': 'Starten', 'empty': 'leer', '{n} not available': '{n} nicht verfügbar', 'not available': 'nicht verfügbar',
    'Nothing selected': 'Nichts ausgewählt', 'Tick one or more mods to launch them together.': 'Hak eine oder mehrere Mods an, um sie zusammen zu starten.',
    '{size} still to download': 'Noch {size} zu laden', 'Everything is downloaded': 'Alles ist geladen', 'Save as modpack': 'Als Modpack speichern',

    'Check the game and the requirements': 'Spiel und Voraussetzungen prüfen', 'Download what is missing': 'Fehlendes herunterladen',
    'Set up loader, mods and your saved data': 'Loader, Mods und deine gespeicherten Daten einrichten', 'Start the game through Steam': 'Spiel über Steam starten',
    'Game is running': 'Spiel läuft', 'Keep mod data and put the game folder back': 'Mod-Daten sichern und Spielordner wiederherstellen', 'Done': 'Fertig',
    'What the launcher does': 'Was der Launcher tut',
    '{game} is running with mods': '{game} läuft mit Mods', 'Getting {game} ready': '{game} wird vorbereitet',
    'Session finished. The game folder is back to how it was.': 'Sitzung beendet. Der Spielordner ist wieder wie vorher.',
    'Kept data of: {mods}': 'Daten gesichert von: {mods}', 'The mods wrote no data this time.': 'Die Mods haben diesmal keine Daten geschrieben.',
    'New files the game left behind: {files}': 'Neue Dateien, die das Spiel hinterlassen hat: {files}',
    'Show loader log': 'Loader-Log anzeigen', 'No log was written.': 'Es wurde kein Log geschrieben.',
    'That did not work': 'Das hat nicht geklappt', 'started': 'gestartet',
    'The game folder will be put back the next time the launcher starts.': 'Der Spielordner wird beim nächsten Start des Launchers wiederhergestellt.',
    'The game folder is unchanged.': 'Der Spielordner ist unverändert.',
    'The game is not installed (or Steam was not found).': 'Das Spiel ist nicht installiert (oder Steam wurde nicht gefunden).',
    'The game is already running. Close it first.': 'Das Spiel läuft bereits. Schließ es zuerst.',
    'This game uses anti-cheat. The launcher does not touch such games.': 'Dieses Spiel benutzt Anti-Cheat. Solche Spiele fasst der Launcher nicht an.',
    'An earlier session of this game has not been cleaned up yet. Restart the launcher.': 'Eine frühere Sitzung dieses Spiels ist noch nicht aufgeräumt. Starte den Launcher neu.',
    'No mod selected.': 'Keine Mod ausgewählt.', 'The game did not start.': 'Das Spiel ist nicht gestartet.',
    'The installed game does not fit the mod loader any more.': 'Das installierte Spiel passt nicht mehr zum Mod-Loader.',
    '{mod} needs {what} on this PC.': '{mod} braucht {what} auf diesem PC.',
    '{a} and {b} cannot be combined.': '{a} und {b} lassen sich nicht kombinieren.',
    '{mod} needs a newer launcher ({v}).': '{mod} braucht einen neueren Launcher ({v}).',
    'Downloads from this unofficial source have not been confirmed.': 'Downloads aus dieser inoffiziellen Quelle wurden nicht bestätigt.',

    '{game} installed through Steam': '{game} über Steam installiert', 'Found': 'Gefunden', 'Not found on this PC': 'Auf diesem PC nicht gefunden',
    'Minecraft Java installed': 'Minecraft Java installiert', 'Missing, the mod cannot be launched': 'Fehlt, die Mod kann nicht gestartet werden',
    'Not found, the mod still works': 'Nicht gefunden, die Mod funktioniert trotzdem',
    'Multiplayer': 'Multiplayer', 'Privacy': 'Datenschutz', 'State of testing': 'Teststand', 'Good to know': 'Gut zu wissen',
    'Remove download': 'Download entfernen', 'Update': 'Aktualisieren', 'Download': 'Herunterladen', 'Add to modpack': 'Zu Modpack hinzufügen',
    'Unofficial source: {name}': 'Inoffizielle Quelle: {name}',
    'This mod does not come from the official catalog. Nobody has checked it. A mod is program code that runs inside the game with your rights. Only use it if you trust the people behind this source.':
      'Diese Mod kommt nicht aus dem offiziellen Katalog. Niemand hat sie geprüft. Eine Mod ist Programmcode, der im Spiel mit deinen Rechten läuft. Benutz sie nur, wenn du den Leuten hinter dieser Quelle vertraust.',
    'by {author}': 'von {author}', 'Keys': 'Tasten', 'You need': 'Das brauchst du', 'You should know': 'Das solltest du wissen', 'Details': 'Details',
    'Version': 'Version', 'Source': 'Quelle', 'Official catalog': 'Offizieller Katalog', 'Mod loader': 'Mod-Loader', 'Package': 'Paket', 'Kept data': 'Gesicherte Daten', 'nothing yet': 'noch nichts',

    'What is on this PC': 'Was auf diesem PC liegt',
    'Mods are listed from the catalogs. A package is only downloaded when you press Download, add the mod to a modpack or launch it. Removing a download never removes the data a mod has saved.':
      'Mods werden aus den Katalogen aufgelistet. Ein Paket wird erst geladen, wenn du auf Herunterladen drückst, die Mod in ein Modpack legst oder sie startest. Einen Download zu entfernen löscht nie die Daten, die eine Mod gespeichert hat.',
    'Downloaded packages': 'Geladene Pakete', 'Nothing downloaded yet.': 'Noch nichts geladen.',

    'Where mods come from': 'Woher Mods kommen',
    'The official catalog is built in. Other people can run their own catalog in the same format. Mods from such sources are marked as unofficial everywhere.':
      'Der offizielle Katalog ist eingebaut. Andere können einen eigenen Katalog im selben Format betreiben. Mods aus solchen Quellen sind überall als inoffiziell markiert.',
    'Add a source': 'Quelle hinzufügen', 'Catalog sources': 'Katalog-Quellen',
    'Not reachable: {why}': 'Nicht erreichbar: {why}', 'Showing the list from {when}.': 'Angezeigt wird die Liste von {when}.', 'Last checked {when}': 'Zuletzt geprüft {when}',
    '{n} mods skipped because this launcher cannot use them.': '{n} Mods übersprungen, weil dieser Launcher sie nicht verwenden kann.',

    'Appearance': 'Aussehen', 'Language': 'Sprache', 'Like the system': 'Wie das System', 'Theme': 'Design', 'Light': 'Hell', 'Dark': 'Dunkel',
    'Finding things': 'Suche', 'Minecraft folder': 'Minecraft-Ordner', 'Only needed if your Minecraft Java is not found by itself.': 'Nur nötig, wenn dein Minecraft Java nicht von selbst gefunden wird.',
    'Choose folder': 'Ordner wählen', 'Launcher data': 'Launcher-Daten', 'Saved mod data, downloads and logs.': 'Gesicherte Mod-Daten, Downloads und Logs.', 'Open folder': 'Ordner öffnen',
    'About': 'Über', 'Updates': 'Updates',
    'The launcher looks for a new release on start and every few hours, downloads it in the background and installs it when you quit.':
      'Der Launcher sucht beim Start und alle paar Stunden nach einer neuen Version, lädt sie im Hintergrund und installiert sie beim Beenden.',

    'Add an unofficial source': 'Inoffizielle Quelle hinzufügen', 'GitHub repository or catalog address': 'GitHub-Repository oder Katalog-Adresse',
    'Mods are program code.': 'Mods sind Programmcode.',
    'A mod runs inside the game with the same rights you have on this PC. It can read, change and send your files.':
      'Eine Mod läuft im Spiel mit denselben Rechten, die du auf diesem PC hast. Sie kann deine Dateien lesen, ändern und verschicken.',
    '{app} does not check mods from unofficial sources. Nobody does.': '{app} prüft Mods aus inoffiziellen Quellen nicht. Niemand tut das.',
    'The checksum only proves that a file arrived unchanged. It does not prove that the file is safe.':
      'Die Prüfsumme beweist nur, dass eine Datei unverändert angekommen ist. Sie beweist nicht, dass die Datei sicher ist.',
    'Only add sources from people you know and trust. A source can deliver a virus.':
      'Füg nur Quellen von Leuten hinzu, die du kennst und denen du vertraust. Eine Quelle kann einen Virus ausliefern.',
    'I understand the risk and I trust this source.': 'Ich verstehe das Risiko und vertraue dieser Quelle.',
    'Add source': 'Quelle hinzufügen', 'This source is already in the list.': 'Diese Quelle steht schon in der Liste.',
    'That address does not work: {why}': 'Diese Adresse funktioniert nicht: {why}', 'Added, but the catalog could not be read yet.': 'Hinzugefügt, aber der Katalog ließ sich noch nicht lesen.',
    'Download from an unofficial source': 'Download aus einer inoffiziellen Quelle', 'You are about to download from:': 'Du lädst gleich herunter von:', 'Download anyway': 'Trotzdem laden',
    'Remove source': 'Quelle entfernen',
    'Remove {name}? Its mods disappear from the list and its downloaded packages are deleted. Data the mods saved stays.':
      '{name} entfernen? Ihre Mods verschwinden aus der Liste und ihre geladenen Pakete werden gelöscht. Daten, die die Mods gespeichert haben, bleiben.',

    'Edit modpack': 'Modpack bearbeiten', 'New modpack': 'Neues Modpack', 'Name': 'Name', 'Friday night': 'Freitagabend', 'Mods in this pack': 'Mods in diesem Pack',
    'Mods you add are downloaded when you save. Settings and saved data belong to each mod, not to the pack.':
      'Mods, die du hinzufügst, werden beim Speichern geladen. Einstellungen und gespeicherte Daten gehören zur jeweiligen Mod, nicht zum Pack.',
    'Delete pack': 'Pack löschen', 'Give the pack a name.': 'Gib dem Pack einen Namen.',
    'Share modpack': 'Modpack teilen',
    'Send this code to your friends. In their launcher: Modpacks, Import code. It lists the mods, their versions and where they come from, nothing else.':
      'Schick diesen Code an deine Freunde. In ihrem Launcher: Modpacks, Code einlösen. Er nennt die Mods, ihre Versionen und woher sie kommen, sonst nichts.',
    'Copy code': 'Code kopieren', 'Code copied': 'Code kopiert',
    'Import modpack': 'Modpack einlösen', 'Modpack code': 'Modpack-Code', 'Read code': 'Code lesen', 'Save pack': 'Pack speichern',
    'This is not a valid modpack code.': 'Das ist kein gültiger Modpack-Code.',
    'This pack is for a game your catalogs do not know.': 'Dieses Pack ist für ein Spiel, das deine Kataloge nicht kennen.',
    'This pack uses unofficial sources you have not added:': 'Dieses Pack benutzt inoffizielle Quellen, die du nicht hinzugefügt hast:',
    'Add them under Sources if you trust them. Until then those mods are missing from the pack.':
      'Füg sie unter Quellen hinzu, wenn du ihnen vertraust. Bis dahin fehlen diese Mods im Pack.',
    '{n} mods of this pack are not in your catalogs.': '{n} Mods dieses Packs stehen nicht in deinen Katalogen.',
    '{n} mods have a different version in the catalog now. You get the current one, and everyone in a lobby needs the same version.':
      '{n} Mods haben im Katalog inzwischen eine andere Version. Du bekommst die aktuelle, und alle in einer Lobby brauchen dieselbe Version.',
  };

  let lang = 'en';
  window.setLang = (l) => { lang = l === 'de' ? 'de' : 'en'; };
  window.T = (key, vars) => {
    let s = lang === 'de' && DE[key] ? DE[key] : key;
    if (vars) for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(vars[k]);
    return s;
  };
})();
