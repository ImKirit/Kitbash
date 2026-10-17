// In-game overlay for mods started through the launcher.
//
// The launcher writes kitbash-overlay.json next to this DLL before the game
// starts and removes both after the session. A hotkey (F10 unless the JSON
// says otherwise) opens a panel that lists the mods of this session, whether
// BepInEx loaded each of them and whether they logged errors. Clicking a mod
// shows its description and how to use it.
//
// Drawn with IMGUI inside the game, so it also works in exclusive fullscreen.
// Keys are read from IMGUI events, which works with the old and the new
// Unity input system.

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using BepInEx;
using BepInEx.Bootstrap;
using BepInEx.Logging;
using UnityEngine;

namespace KitbashOverlay
{
    [BepInPlugin(Guid, "Kitbash Overlay", "0.2.0")]
    public class OverlayPlugin : BaseUnityPlugin
    {
        public const string Guid = "dev.imkirit.kitbash.overlay";

        private OverlayData data;
        private KeyCode hotkey = KeyCode.F10;
        private bool open;
        private int selected = -1;
        private Vector2 listScroll;
        private Vector2 detailScroll;
        private readonly List<LogLine> problems = new List<LogLine>();
        private List<ModState> states;
        private float statesAt = -10f;

        private CursorLockMode savedLock;
        private bool savedVisible;
        private float startedAt;
        private bool selfTestDone;

        private Styles s;

        private void Awake()
        {
            startedAt = Time.realtimeSinceStartup;
            string file = Path.Combine(Path.GetDirectoryName(Info.Location) ?? "", "kitbash-overlay.json");
            try
            {
                data = JsonUtility.FromJson<OverlayData>(File.ReadAllText(file));
            }
            catch (Exception e)
            {
                Logger.LogWarning("No session data, the overlay shows the loaded plugins only: " + e.Message);
                data = new OverlayData();
            }
            if (data.mods == null) data.mods = new ModInfo[0];
            if (data.text == null) data.text = new Texts();
            if (!string.IsNullOrEmpty(data.hotkey))
            {
                try { hotkey = (KeyCode)Enum.Parse(typeof(KeyCode), data.hotkey, true); }
                catch { Logger.LogWarning("Unknown hotkey " + data.hotkey + ", using F10"); }
            }
            BepInEx.Logging.Logger.Listeners.Add(new ProblemListener(problems));
            Logger.LogInfo("Kitbash overlay ready, " + data.mods.Length + " mod(s) in this session, open with " + hotkey);
        }

        // ---- state of the mods -------------------------------------------------
        private List<ModState> Collect()
        {
            var plugins = Chainloader.PluginInfos.Values.ToList();
            var list = new List<ModState>();
            foreach (var mod in data.mods)
            {
                var st = new ModState { Mod = mod };
                foreach (var p in plugins)
                {
                    string loc = SafeFull(p.Location);
                    if (mod.dlls != null && mod.dlls.Any(d => loc.EndsWith(d.Replace('/', '\\'), StringComparison.OrdinalIgnoreCase)))
                        st.Plugins.Add(p);
                }
                var names = new HashSet<string>(st.Plugins.Select(p => p.Metadata.Name), StringComparer.OrdinalIgnoreCase);
                lock (problems) st.Errors.AddRange(problems.Where(l => names.Contains(l.Source)).Select(l => l.Text));
                foreach (var dep in Chainloader.DependencyErrors)
                    if (names.Any(n => dep.IndexOf(n, StringComparison.OrdinalIgnoreCase) >= 0) || (mod.name != null && dep.IndexOf(mod.name, StringComparison.OrdinalIgnoreCase) >= 0))
                        st.Errors.Add(dep);
                st.Loaded = st.Plugins.Count > 0 && st.Plugins.All(p => p.Instance != null);
                list.Add(st);
            }
            return list;
        }

        private static string SafeFull(string path)
        {
            try { return Path.GetFullPath(path ?? ""); } catch { return path ?? ""; }
        }

        // ---- input and cursor ----------------------------------------------------
        private void Toggle(bool on)
        {
            if (on == open) return;
            open = on;
            if (open)
            {
                savedLock = Cursor.lockState;
                savedVisible = Cursor.visible;
            }
            else
            {
                Cursor.lockState = savedLock;
                Cursor.visible = savedVisible;
            }
        }

        private void LateUpdate()
        {
            if (!open) return;
            Cursor.lockState = CursorLockMode.None;
            Cursor.visible = true;
        }

        private void OnGUI()
        {
            Event e = Event.current;
            if (e.type == EventType.KeyDown && e.keyCode == hotkey)
            {
                Toggle(!open);
                e.Use();
            }
            if (open && e.type == EventType.KeyDown && e.keyCode == KeyCode.Escape)
            {
                if (selected >= 0) selected = -1; else Toggle(false);
                e.Use();
            }

            bool selfTest = data.selfTest != null && !string.IsNullOrEmpty(data.selfTest.screenshot) && !selfTestDone
                && Time.realtimeSinceStartup - startedAt > Math.Max(3f, data.selfTest.delaySeconds);
            if (selfTest && !open) { Toggle(true); if (data.mods.Length > 0) selected = 0; }
            if (!open) return;

            if (s == null) s = new Styles();
            if (states == null || Time.realtimeSinceStartup - statesAt > 2f)
            {
                states = Collect();
                statesAt = Time.realtimeSinceStartup;
            }

            if (selfTest && e.type == EventType.Repaint) SelfTestPicture();
            else Draw();
        }

        // ---- drawing -------------------------------------------------------------
        private void Draw()
        {
            float w = Mathf.Min(460f, Screen.width - 40f);
            float h = Mathf.Min(Screen.height - 80f, 120f + Math.Max(1, states.Count) * 54f + 60f);
            var panel = new Rect(30f, 30f, w, h);
            GUI.Box(panel, GUIContent.none, s.Panel);
            GUILayout.BeginArea(new Rect(panel.x + 18f, panel.y + 14f, panel.width - 36f, panel.height - 28f));

            GUILayout.Label(T(data.text.title, "KITBASH  ·  MODS IN THIS SESSION"), s.Head);
            GUILayout.Space(6f);
            int ok = states.Count(x => x.Loaded && x.Errors.Count == 0);
            GUILayout.Label(string.Format(T(data.text.summary, "{0} of {1} loaded without problems"), ok, states.Count), s.Muted);
            GUILayout.Space(10f);

            listScroll = GUILayout.BeginScrollView(listScroll, GUIStyle.none, GUIStyle.none);
            for (int i = 0; i < states.Count; i++)
            {
                var st = states[i];
                string status = !st.Loaded ? T(data.text.notLoaded, "not loaded")
                    : st.Errors.Count > 0 ? string.Format(T(data.text.errors, "loaded, {0} error(s)"), st.Errors.Count)
                    : T(data.text.loaded, "loaded");
                GUIStyle dot = !st.Loaded ? s.Bad : st.Errors.Count > 0 ? s.Warn : s.Ok;
                GUILayout.BeginHorizontal(i == selected ? s.RowOn : s.Row);
                GUILayout.Label("●", dot, GUILayout.Width(18f));
                GUILayout.BeginVertical();
                GUILayout.Label(st.Mod.name + "  " + st.Mod.version, s.Name);
                GUILayout.Label(status, s.Muted);
                GUILayout.EndVertical();
                GUILayout.EndHorizontal();
                Rect r = GUILayoutUtility.GetLastRect();
                if (Event.current.type == EventType.MouseDown && r.Contains(Event.current.mousePosition))
                {
                    selected = selected == i ? -1 : i;
                    detailScroll = Vector2.zero;
                    Event.current.Use();
                }
            }
            if (states.Count == 0) GUILayout.Label(T(data.text.empty, "No mod data for this session."), s.Muted);
            GUILayout.EndScrollView();

            GUILayout.FlexibleSpace();
            GUILayout.Label(string.Format(T(data.text.footer, "{0} closes  ·  click a mod for how to use it"), hotkey), s.Muted);
            GUILayout.EndArea();

            if (selected >= 0 && selected < states.Count) DrawDetail(states[selected], new Rect(panel.xMax + 14f, panel.y, Mathf.Min(480f, Screen.width - panel.xMax - 44f), panel.height));
        }

        private void DrawDetail(ModState st, Rect r)
        {
            if (r.width < 200f) r = new Rect(30f, 30f, Mathf.Min(480f, Screen.width - 60f), Screen.height - 80f);
            GUI.Box(r, GUIContent.none, s.Panel);
            GUILayout.BeginArea(new Rect(r.x + 18f, r.y + 14f, r.width - 36f, r.height - 28f));
            GUILayout.BeginHorizontal();
            GUILayout.Label(st.Mod.name, s.Title);
            GUILayout.FlexibleSpace();
            if (GUILayout.Button("×", s.Close, GUILayout.Width(26f))) selected = -1;
            GUILayout.EndHorizontal();
            detailScroll = GUILayout.BeginScrollView(detailScroll, GUIStyle.none, GUIStyle.none);
            if (!string.IsNullOrEmpty(st.Mod.summary)) GUILayout.Label(st.Mod.summary, s.Body);

            var u = st.Mod.usage;
            if (u != null && u.keys != null && u.keys.Length > 0)
            {
                GUILayout.Space(10f);
                GUILayout.Label(T(data.text.keys, "KEYS"), s.Head);
                foreach (var k in u.keys)
                {
                    GUILayout.BeginHorizontal();
                    GUILayout.Label(k.key, s.Key, GUILayout.Width(120f));
                    GUILayout.Label(k.text, s.Body);
                    GUILayout.EndHorizontal();
                }
            }
            if (u != null && u.steps != null && u.steps.Length > 0)
            {
                GUILayout.Space(10f);
                GUILayout.Label(T(data.text.steps, "HOW TO USE IT"), s.Head);
                for (int i = 0; i < u.steps.Length; i++) GUILayout.Label((i + 1) + ".  " + u.steps[i], s.Body);
            }
            if (st.Errors.Count > 0)
            {
                GUILayout.Space(10f);
                GUILayout.Label(T(data.text.problems, "PROBLEMS"), s.Head);
                foreach (var line in st.Errors.Take(12)) GUILayout.Label(line, s.WarnText);
            }
            else if (!st.Loaded)
            {
                GUILayout.Space(10f);
                GUILayout.Label(T(data.text.notLoadedHelp, "BepInEx did not load this mod. The loader log has the reason."), s.WarnText);
            }
            GUILayout.EndScrollView();
            GUILayout.EndArea();
        }

        private static string T(string value, string fallback) => string.IsNullOrEmpty(value) ? fallback : value;

        // Draws the overlay once into a texture and saves it as PNG. Only runs
        // when the launcher asks for it (self-test), never in normal play.
        private void SelfTestPicture()
        {
            selfTestDone = true;
            int w = Screen.width, h = Screen.height;
            var rt = new RenderTexture(w, h, 24);
            var previous = RenderTexture.active;
            try
            {
                RenderTexture.active = rt;
                GL.Clear(true, true, new Color(0.08f, 0.09f, 0.1f, 1f));
                Draw();
                var tex = new Texture2D(w, h, TextureFormat.RGB24, false);
                tex.ReadPixels(new Rect(0, 0, w, h), 0, 0);
                tex.Apply();
                File.WriteAllBytes(data.selfTest.screenshot, ImageConversion.EncodeToPNG(tex));
                Destroy(tex);
                Logger.LogInfo("Self-test picture saved: " + data.selfTest.screenshot + " (" + w + "x" + h + ", " + states.Count + " mod(s), "
                    + states.Count(x => x.Loaded) + " loaded)");
            }
            catch (Exception ex)
            {
                Logger.LogError("Self-test picture failed: " + ex.Message);
            }
            finally
            {
                RenderTexture.active = previous;
                rt.Release();
                Destroy(rt);
            }
        }

        private class ModState
        {
            public ModInfo Mod;
            public readonly List<PluginInfo> Plugins = new List<PluginInfo>();
            public readonly List<string> Errors = new List<string>();
            public bool Loaded;
        }

        private struct LogLine
        {
            public string Source;
            public string Text;
        }

        // Collects warnings that matter: errors and fatal messages of any plugin.
        private class ProblemListener : ILogListener
        {
            private readonly List<LogLine> sink;
            public ProblemListener(List<LogLine> sink) { this.sink = sink; }
            public void LogEvent(object sender, LogEventArgs e)
            {
                if ((e.Level & (LogLevel.Error | LogLevel.Fatal)) == 0) return;
                lock (sink)
                {
                    if (sink.Count < 400) sink.Add(new LogLine { Source = e.Source?.SourceName ?? "", Text = Convert.ToString(e.Data) });
                }
            }
            public void Dispose() { }
        }

        // Flat, dark, thin. Built once from 1x1 textures.
        private class Styles
        {
            public readonly GUIStyle Panel, Row, RowOn, Head, Muted, Name, Title, Body, Key, Ok, Warn, Bad, WarnText, Close;

            private static Texture2D Solid(Color c)
            {
                var t = new Texture2D(1, 1);
                t.SetPixel(0, 0, c);
                t.Apply();
                t.hideFlags = HideFlags.HideAndDontSave;
                return t;
            }

            private static GUIStyle Text(int size, Color c, FontStyle style = FontStyle.Normal)
            {
                var g = new GUIStyle(GUI.skin.label) { fontSize = size, fontStyle = style, wordWrap = true, richText = false };
                g.normal.textColor = c;
                return g;
            }

            public Styles()
            {
                Color silver = new Color(0.79f, 0.80f, 0.82f);
                Color white = new Color(0.96f, 0.96f, 0.97f);
                Color muted = new Color(0.66f, 0.67f, 0.69f);
                Panel = new GUIStyle { border = new RectOffset(1, 1, 1, 1) };
                Panel.normal.background = Solid(new Color(0.02f, 0.02f, 0.025f, 0.94f));
                Row = new GUIStyle { padding = new RectOffset(8, 8, 6, 6), margin = new RectOffset(0, 0, 2, 2) };
                RowOn = new GUIStyle(Row);
                RowOn.normal.background = Solid(new Color(0.79f, 0.80f, 0.82f, 0.10f));
                Head = Text(11, silver, FontStyle.Bold);
                Muted = Text(12, muted);
                Name = Text(14, white);
                Title = Text(17, white);
                Body = Text(13, white);
                Key = Text(13, silver, FontStyle.Bold);
                Ok = Text(14, new Color(0.37f, 0.84f, 0.58f));
                Warn = Text(14, new Color(0.95f, 0.74f, 0.34f));
                Bad = Text(14, new Color(1f, 0.56f, 0.52f));
                WarnText = Text(12, new Color(0.95f, 0.74f, 0.34f));
                Close = Text(18, muted);
                Close.hover.textColor = new Color(1f, 0.45f, 0.42f);
                Close.alignment = TextAnchor.MiddleCenter;
            }
        }
    }

    // ---- the JSON the launcher writes ---------------------------------------------
    [Serializable] public class OverlayData
    {
        public string hotkey;
        public string lang;
        public Texts text;
        public ModInfo[] mods;
        public SelfTest selfTest;
    }

    [Serializable] public class ModInfo
    {
        public string id;
        public string name;
        public string version;
        public string summary;
        public string[] dlls;
        public Usage usage;
    }

    [Serializable] public class Usage
    {
        public KeyInfo[] keys;
        public string[] steps;
    }

    [Serializable] public class KeyInfo
    {
        public string key;
        public string text;
    }

    [Serializable] public class SelfTest
    {
        public string screenshot;
        public float delaySeconds;
    }

    [Serializable] public class Texts
    {
        public string title, summary, loaded, notLoaded, errors, empty, footer, keys, steps, problems, notLoadedHelp;
    }
}
