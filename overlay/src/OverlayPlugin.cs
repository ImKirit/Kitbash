// In-game overlay for mods started through the launcher.
//
// The launcher writes kitbash-overlay.json next to this DLL before the game
// starts and removes both after the session. A hotkey (F10 unless the JSON
// says otherwise) opens a panel at the left middle of the screen that lists
// the mods of this session, whether BepInEx loaded each of them and whether
// they logged errors. Clicking a mod attaches its details to the panel.
// The panel moves by its header and keeps its place for the session.
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
        private const float PanelWidth = 420f;
        private const float DetailWidth = 440f;
        private const float HeaderHeight = 54f;
        private const float Pad = 20f;

        private OverlayData data;
        private KeyCode hotkey = KeyCode.F10;
        private bool open;
        private int selected = -1;
        private int hover = -1;
        private Vector2 listScroll;
        private Vector2 detailScroll;
        private readonly List<LogLine> problems = new List<LogLine>();
        private List<ModState> states;
        private float statesAt = -10f;

        private Rect panel;
        private bool placed;
        private bool dragging;
        private Vector2 dragOffset;

        private CursorLockMode savedLock;
        private bool savedVisible;
        private float startedAt;
        private bool selfTestDone;
        private bool heartbeat;

        private Styles s;
        private Texture2D gameIcon;
        private readonly Dictionary<string, Texture2D> images = new Dictionary<string, Texture2D>();

        private bool SelfTestWanted => data.selfTest != null && !string.IsNullOrEmpty(data.selfTest.screenshot);

        private void Awake()
        {
            startedAt = Time.realtimeSinceStartup;
            string file = Path.Combine(Path.GetDirectoryName(Info.Location) ?? "", "kitbash-overlay.json");
            try { data = MiniJson.ToData(MiniJson.Parse(File.ReadAllText(file))); }
            catch (Exception e)
            {
                Logger.LogWarning("No session data, the overlay shows the loaded plugins only: " + e.Message);
                data = new OverlayData();
            }
            if (data.mods == null) data.mods = new ModInfo[0];
            if (data.text == null) data.text = new Texts();
            data.opacity = data.opacity <= 0f ? 0.94f : Mathf.Clamp(data.opacity, 0.6f, 1f);
            if (!string.IsNullOrEmpty(data.hotkey))
            {
                try { hotkey = (KeyCode)Enum.Parse(typeof(KeyCode), data.hotkey, true); }
                catch { Logger.LogWarning("Unknown hotkey " + data.hotkey + ", using F10"); }
            }
            // The self-test must also run while the game window has no focus.
            if (SelfTestWanted) Application.runInBackground = true;
            BepInEx.Logging.Logger.Listeners.Add(new ProblemListener(problems));
            // Some games destroy the loader's own object when a scene loads. The
            // overlay runs on an object of its own that survives scene changes.
            var host = new GameObject("KitbashOverlay") { hideFlags = HideFlags.HideAndDontSave };
            DontDestroyOnLoad(host);
            host.AddComponent<OverlayRunner>().Owner = this;
            Logger.LogInfo("Kitbash overlay ready, " + data.mods.Length + " mod(s) in this session, open with " + hotkey + (data.demo ? ", DEMO MODE (all mods shown as loaded)" : ""));
        }

        // ---- pictures (local files the launcher prepared) -------------------------
        private static Texture2D Load(string path)
        {
            try
            {
                if (string.IsNullOrEmpty(path) || !File.Exists(path) || new FileInfo(path).Length > 8 * 1024 * 1024) return null;
                var t = new Texture2D(2, 2, TextureFormat.RGBA32, false) { hideFlags = HideFlags.HideAndDontSave, filterMode = FilterMode.Bilinear };
                return ImageConversion.LoadImage(t, File.ReadAllBytes(path)) ? t : null;
            }
            catch { return null; }
        }

        private Texture2D ImageOf(ModInfo m)
        {
            if (m == null || string.IsNullOrEmpty(m.image)) return null;
            if (!images.TryGetValue(m.image, out var t)) { t = Load(m.image); images[m.image] = t; }
            return t;
        }

        // ---- state of the mods -------------------------------------------------
        private List<ModState> DemoStates() => data.mods.Select(m => new ModState { Mod = m, Loaded = true }).ToList();

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

        // ---- frame callbacks (from OverlayRunner) --------------------------------
        private void Toggle(bool on)
        {
            if (on == open) return;
            open = on;
            if (open) { savedLock = Cursor.lockState; savedVisible = Cursor.visible; }
            else { Cursor.lockState = savedLock; Cursor.visible = savedVisible; dragging = false; }
        }

        public void Tick()
        {
            // Self-test only: proves that frames run, next to the picture.
            if (!heartbeat && SelfTestWanted && Time.realtimeSinceStartup - startedAt > data.selfTest.delaySeconds + 5f)
            {
                heartbeat = true;
                try { File.WriteAllText(Path.ChangeExtension(data.selfTest.screenshot, ".frames.txt"), "frames run, focused " + Application.isFocused + ", picture taken " + selfTestDone); } catch { }
            }
            if (!open) return;
            Cursor.lockState = CursorLockMode.None;
            Cursor.visible = true;
        }

        public void Gui()
        {
            Event e = Event.current;
            if (e.type == EventType.KeyDown && e.keyCode == hotkey) { Toggle(!open); e.Use(); }
            if (open && e.type == EventType.KeyDown && e.keyCode == KeyCode.Escape)
            {
                if (selected >= 0) selected = -1; else Toggle(false);
                e.Use();
            }

            bool selfTest = SelfTestWanted && !selfTestDone && Time.realtimeSinceStartup - startedAt > Math.Max(3f, data.selfTest.delaySeconds);
            if (selfTest && !open) Toggle(true);
            if (!open) return;

            if (s == null) { s = new Styles(data.opacity); gameIcon = Load(data.gameIcon); }
            if (states == null || Time.realtimeSinceStartup - statesAt > 2f)
            {
                states = data.demo ? DemoStates() : Collect();
                statesAt = Time.realtimeSinceStartup;
            }
            float h = Mathf.Min(Screen.height - 60f, HeaderHeight + 96f + Math.Max(1, states.Count) * 72f + 56f);
            if (!placed) { panel = new Rect(28f, Mathf.Round((Screen.height - h) / 2f), PanelWidth, h); placed = true; }
            panel.height = h;

            if (selfTest)
            {
                if (selected < 0 && states.Count > 0) selected = 0;
                // the layout pass has to see the same controls as the drawing pass
                if (e.type == EventType.Layout) Draw();
                else if (e.type == EventType.Repaint) SelfTestPicture();
                return;
            }
            Drag(e);
            Draw();
        }

        private void Drag(Event e)
        {
            var header = new Rect(panel.x, panel.y, panel.width - 44f, HeaderHeight);
            if (e.type == EventType.MouseDown && e.button == 0 && header.Contains(e.mousePosition)) { dragging = true; dragOffset = e.mousePosition - panel.position; e.Use(); }
            else if (dragging && e.type == EventType.MouseDrag)
            {
                panel.position = e.mousePosition - dragOffset;
                panel.x = Mathf.Clamp(panel.x, 0f, Screen.width - 120f);
                panel.y = Mathf.Clamp(panel.y, 0f, Screen.height - 60f);
                e.Use();
            }
            else if (e.type == EventType.MouseUp) dragging = false;
        }

        // ---- drawing -------------------------------------------------------------
        // Header strip with grip dots, title and close; then a status line, a
        // section label and filled rows. Small square status marks, key hints in
        // a mono font on the right.
        private void Header(Rect r, string title, Texture2D icon, string right, bool closeDetail)
        {
            GUI.Box(new Rect(r.x, r.y, r.width, HeaderHeight), GUIContent.none, s.Header);
            float x = r.x + 18f;
            for (int i = 0; i < 6; i++) GUI.Box(new Rect(x + (i % 3) * 6f, r.y + 21f + (i / 3) * 6f, 3f, 3f), GUIContent.none, s.Grip);
            x += 26f;
            if (icon != null) { GUI.DrawTexture(new Rect(x, r.y + 13f, 28f, 28f), icon, ScaleMode.ScaleToFit); x += 38f; }
            var size = s.Title.CalcSize(new GUIContent(title));
            float maxW = r.width - (x - r.x) - 140f;
            GUI.Label(new Rect(x, r.y + 12f, Mathf.Min(size.x, maxW), 30f), title, s.Title);
            GUI.Box(new Rect(x + Mathf.Min(size.x, maxW) + 4f, r.y + 30f, 6f, 6f), GUIContent.none, s.Accent);
            if (!string.IsNullOrEmpty(right)) GUI.Label(new Rect(r.xMax - 150f, r.y + 17f, 100f, 20f), right, s.MonoRight);
            if (GUI.Button(new Rect(r.xMax - 42f, r.y + 13f, 28f, 28f), "×", s.Close)) { if (closeDetail) selected = -1; else Toggle(false); }
        }

        private void Draw()
        {
            GUI.Box(panel, GUIContent.none, s.Panel);
            Header(panel, string.IsNullOrEmpty(data.gameName) ? "Kitbash" : data.gameName, gameIcon, data.demo ? "Demo" : T(data.text.drag, "Drag to move"), false);

            GUILayout.BeginArea(new Rect(panel.x + Pad, panel.y + HeaderHeight + 16f, panel.width - Pad * 2f, panel.height - HeaderHeight - 28f));
            int ok = states.Count(x => x.Loaded && x.Errors.Count == 0);
            bool allGood = ok == states.Count;
            GUILayout.BeginHorizontal();
            GUILayout.Label(GUIContent.none, allGood ? s.SqOk : s.SqWarn, GUILayout.Width(10f), GUILayout.Height(10f));
            GUILayout.Space(10f);
            GUILayout.Label(string.Format(T(data.text.summary, "{0} of {1} loaded without problems"), ok, states.Count), s.Status);
            GUILayout.FlexibleSpace();
            GUILayout.EndHorizontal();
            GUILayout.Space(14f);
            GUILayout.Label(string.IsNullOrEmpty(data.packName) ? T(data.text.title, "Mods in this session") : T(data.text.pack, "Modpack") + "  " + data.packName, s.Section);
            GUILayout.Space(4f);

            listScroll = GUILayout.BeginScrollView(listScroll, GUIStyle.none, GUIStyle.none);
            int newHover = -1;
            for (int i = 0; i < states.Count; i++)
            {
                var st = states[i];
                bool good = st.Loaded && st.Errors.Count == 0;
                string status = !st.Loaded ? T(data.text.notLoaded, "not loaded")
                    : st.Errors.Count > 0 ? string.Format(T(data.text.errors, "{0} error(s)"), st.Errors.Count)
                    : T(data.text.loaded, "loaded");
                GUIStyle row = i == selected ? s.RowOn : i == hover ? s.RowHover : s.Row;
                GUILayout.BeginHorizontal(row, GUILayout.Height(60f));
                var img = ImageOf(st.Mod);
                GUILayout.Label(GUIContent.none, s.Thumb, GUILayout.Width(60f), GUILayout.Height(40f));
                if (img != null) { var tr = GUILayoutUtility.GetLastRect(); GUI.DrawTexture(new Rect(tr.x + 1f, tr.y + 1f, tr.width - 2f, tr.height - 2f), img, ScaleMode.ScaleAndCrop); }
                GUILayout.Space(14f);
                GUILayout.BeginVertical();
                GUILayout.FlexibleSpace();
                GUILayout.Label(st.Mod.name, s.Name);
                GUILayout.BeginHorizontal();
                GUILayout.Label(GUIContent.none, good ? s.SqOk : !st.Loaded ? s.SqBad : s.SqWarn, GUILayout.Width(8f), GUILayout.Height(8f));
                GUILayout.Space(6f);
                GUILayout.Label(status, good ? s.MonoOk : !st.Loaded ? s.MonoBad : s.MonoWarn);
                GUILayout.FlexibleSpace();
                GUILayout.EndHorizontal();
                GUILayout.FlexibleSpace();
                GUILayout.EndVertical();
                GUILayout.Label(st.Mod.version, s.MonoRight, GUILayout.Width(52f));
                GUILayout.EndHorizontal();
                Rect r = GUILayoutUtility.GetLastRect();
                if (r.Contains(Event.current.mousePosition)) newHover = i;
                if (Event.current.type == EventType.MouseDown && r.Contains(Event.current.mousePosition))
                {
                    selected = selected == i ? -1 : i;
                    detailScroll = Vector2.zero;
                    Event.current.Use();
                }
                GUILayout.Space(8f);
            }
            if (Event.current.type == EventType.Repaint) hover = newHover;
            if (states.Count == 0) GUILayout.Label(T(data.text.empty, "No mod data for this session."), s.Muted);
            GUILayout.EndScrollView();

            GUILayout.FlexibleSpace();
            GUILayout.BeginHorizontal();
            GUILayout.Label(T(data.text.footerHint, "Click a mod for how to use it"), s.Muted);
            GUILayout.FlexibleSpace();
            GUILayout.Label(hotkey.ToString(), s.KeyHint);
            GUILayout.EndHorizontal();
            GUILayout.EndArea();

            if (selected >= 0 && selected < states.Count)
            {
                float x = panel.xMax + 10f;
                if (x + DetailWidth > Screen.width - 12f) x = Mathf.Max(12f, panel.x - DetailWidth - 10f);
                DrawDetail(states[selected], new Rect(x, panel.y, DetailWidth, Mathf.Max(panel.height, 520f)));
            }
        }

        private void DrawDetail(ModState st, Rect r)
        {
            r.height = Mathf.Min(r.height, Screen.height - r.y - 12f);
            GUI.Box(r, GUIContent.none, s.Panel);
            Header(r, st.Mod.name, null, st.Mod.version, true);
            float top = HeaderHeight + 14f;
            var img = ImageOf(st.Mod);
            if (img != null)
            {
                var frame = new Rect(r.x + Pad, r.y + top, r.width - Pad * 2f, 150f);
                GUI.Box(frame, GUIContent.none, s.Thumb);
                GUI.DrawTexture(new Rect(frame.x + 1f, frame.y + 1f, frame.width - 2f, frame.height - 2f), img, ScaleMode.ScaleAndCrop);
                top += 164f;
            }
            GUILayout.BeginArea(new Rect(r.x + Pad, r.y + top, r.width - Pad * 2f, r.height - top - 16f));
            detailScroll = GUILayout.BeginScrollView(detailScroll, GUIStyle.none, GUIStyle.none);
            if (!string.IsNullOrEmpty(st.Mod.summary)) GUILayout.Label(st.Mod.summary, s.Body);

            var u = st.Mod.usage;
            if (u != null && u.steps != null && u.steps.Length > 0)
            {
                GUILayout.Space(16f);
                GUILayout.Label(T(data.text.steps, "How to use it"), s.Section);
                for (int i = 0; i < u.steps.Length; i++)
                {
                    GUILayout.BeginHorizontal();
                    GUILayout.Label((i + 1).ToString(), s.Num, GUILayout.Width(18f));
                    GUILayout.Label(u.steps[i], s.Body);
                    GUILayout.EndHorizontal();
                    GUILayout.Space(4f);
                }
            }
            if (u != null && u.keys != null && u.keys.Length > 0)
            {
                GUILayout.Space(14f);
                GUILayout.Label(T(data.text.keys, "Keys"), s.Section);
                foreach (var k in u.keys)
                {
                    GUILayout.BeginHorizontal(s.Row);
                    GUILayout.Label(k.text, s.Body);
                    GUILayout.Space(10f);
                    GUILayout.Label(k.key, s.KeyHint, GUILayout.ExpandWidth(false));
                    GUILayout.EndHorizontal();
                    GUILayout.Space(6f);
                }
            }
            if (st.Errors.Count > 0)
            {
                GUILayout.Space(14f);
                GUILayout.Label(T(data.text.problems, "Problems"), s.Section);
                foreach (var line in st.Errors.Take(12)) GUILayout.Label(line, s.MonoWarn);
            }
            else if (!st.Loaded)
            {
                GUILayout.Space(14f);
                GUILayout.Label(T(data.text.notLoadedHelp, "BepInEx did not load this mod. The loader log has the reason."), s.MonoWarn);
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
                GL.Clear(true, true, new Color(0.16f, 0.17f, 0.19f, 1f));
                Draw();
                var tex = new Texture2D(w, h, TextureFormat.RGB24, false);
                tex.ReadPixels(new Rect(0, 0, w, h), 0, 0);
                tex.Apply();
                File.WriteAllBytes(data.selfTest.screenshot, ImageConversion.EncodeToPNG(tex));
                Destroy(tex);
                Logger.LogInfo("Self-test picture saved: " + data.selfTest.screenshot + " (" + w + "x" + h + ", " + states.Count + " mod(s), " + states.Count(x => x.Loaded) + " loaded)");
            }
            catch (Exception ex) { Logger.LogError("Self-test picture failed: " + ex.Message); }
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

        // Collects errors and fatal messages of any plugin.
        private class ProblemListener : ILogListener
        {
            private readonly List<LogLine> sink;
            public ProblemListener(List<LogLine> sink) { this.sink = sink; }
            public void LogEvent(object sender, LogEventArgs e)
            {
                if ((e.Level & (LogLevel.Error | LogLevel.Fatal)) == 0) return;
                lock (sink) { if (sink.Count < 400) sink.Add(new LogLine { Source = e.Source?.SourceName ?? "", Text = Convert.ToString(e.Data) }); }
            }
            public void Dispose() { }
        }

        // Dark, nearly opaque surfaces with rounded corners (9-sliced textures),
        // a lighter header strip, filled rows, square status marks, mono hints.
        private class Styles
        {
            public readonly GUIStyle Panel, Header, Grip, Accent, Row, RowHover, RowOn, Thumb, Title, Name, Body, Muted, Section, Status,
                MonoRight, MonoOk, MonoWarn, MonoBad, KeyHint, Num, SqOk, SqWarn, SqBad, Close;

            private static Texture2D Rounded(Color fill, Color edge, int radius, bool topOnly = false)
            {
                int size = radius * 2 + 4;
                var t = new Texture2D(size, size, TextureFormat.RGBA32, false) { hideFlags = HideFlags.HideAndDontSave, filterMode = FilterMode.Bilinear, wrapMode = TextureWrapMode.Clamp };
                var px = new Color[size * size];
                float rr = radius;
                for (int y = 0; y < size; y++)
                    for (int x = 0; x < size; x++)
                    {
                        // texture rows start at the bottom: y >= size / 2 is the top half
                        bool round = !topOnly || y >= size / 2;
                        float cx = Mathf.Clamp(x + 0.5f, rr, size - rr), cy = Mathf.Clamp(y + 0.5f, rr, size - rr);
                        float d = round ? Mathf.Sqrt((x + 0.5f - cx) * (x + 0.5f - cx) + (y + 0.5f - cy) * (y + 0.5f - cy)) : 0f;
                        float inside = Mathf.Clamp01(rr - d + 0.5f);
                        float border = edge.a > 0f ? Mathf.Clamp01(d - (rr - 1.5f)) : 0f;
                        Color c = Color.Lerp(fill, edge, border);
                        c.a *= inside;
                        px[y * size + x] = c;
                    }
                t.SetPixels(px);
                t.Apply();
                return t;
            }

            private static GUIStyle Surface(Texture2D tex, int radius, RectOffset padding)
            {
                var g = new GUIStyle { border = new RectOffset(radius + 2, radius + 2, radius + 2, radius + 2), padding = padding };
                g.normal.background = tex;
                return g;
            }

            private static Font Os(string name, int size)
            {
                try { return Font.CreateDynamicFontFromOSFont(name, size); } catch { return null; }
            }

            private static GUIStyle Text(Font font, int size, Color c, FontStyle style = FontStyle.Normal)
            {
                var g = new GUIStyle(GUI.skin.label) { fontSize = size, fontStyle = style, wordWrap = true, richText = false, margin = new RectOffset(0, 0, 1, 1), padding = new RectOffset(0, 0, 1, 1) };
                if (font != null) g.font = font;
                g.normal.textColor = c;
                return g;
            }

            private static GUIStyle Square(Color c)
            {
                var g = new GUIStyle { margin = new RectOffset(0, 0, 5, 0) };
                g.normal.background = Rounded(c, new Color(0, 0, 0, 0), 1);
                g.border = new RectOffset(1, 1, 1, 1);
                return g;
            }

            public Styles(float opacity)
            {
                Font ui = Os("Segoe UI", 14);
                Font uiBold = Os("Segoe UI Semibold", 14) ?? ui;
                Font mono = Os("Consolas", 12);
                Color bg = new Color(0.067f, 0.067f, 0.078f, opacity);
                Color surface2 = new Color(0.11f, 0.11f, 0.13f, 1f);
                Color silver = new Color(0.79f, 0.80f, 0.82f);
                Color white = new Color(0.95f, 0.95f, 0.97f);
                Color muted = new Color(0.62f, 0.63f, 0.68f);
                Color faint = new Color(0.43f, 0.44f, 0.50f);
                Color green = new Color(0.24f, 0.86f, 0.59f), amber = new Color(1f, 0.69f, 0.13f), red = new Color(1f, 0.33f, 0.36f);

                Panel = Surface(Rounded(bg, new Color(1f, 1f, 1f, 0.07f), 16), 16, new RectOffset(0, 0, 0, 0));
                Header = Surface(Rounded(new Color(0.12f, 0.12f, 0.14f, Mathf.Min(1f, opacity + 0.04f)), new Color(0, 0, 0, 0), 16, true), 16, new RectOffset(0, 0, 0, 0));
                Grip = Square(faint);
                Accent = Square(silver);
                Row = Surface(Rounded(surface2, new Color(0, 0, 0, 0), 10), 10, new RectOffset(12, 14, 8, 8));
                RowHover = Surface(Rounded(new Color(0.14f, 0.14f, 0.165f, 1f), new Color(0, 0, 0, 0), 10), 10, Row.padding);
                RowOn = Surface(Rounded(new Color(0.17f, 0.175f, 0.19f, 1f), new Color(0.79f, 0.80f, 0.82f, 0.55f), 10), 10, Row.padding);
                Thumb = Surface(Rounded(new Color(0.16f, 0.16f, 0.18f, 1f), new Color(1f, 1f, 1f, 0.10f), 6), 6, new RectOffset(0, 0, 0, 0));

                Title = Text(uiBold, 19, white); Title.wordWrap = false; Title.clipping = TextClipping.Clip;
                Name = Text(uiBold, 15, white); Name.wordWrap = false; Name.clipping = TextClipping.Clip;
                Body = Text(ui, 14, new Color(0.88f, 0.88f, 0.91f));
                Status = Text(uiBold, 15, white);
                Muted = Text(ui, 12, muted);
                Section = Text(mono, 12, faint);
                Section.margin = new RectOffset(0, 0, 2, 6);
                MonoRight = Text(mono, 12, faint); MonoRight.alignment = TextAnchor.MiddleRight; MonoRight.wordWrap = false;
                MonoOk = Text(mono, 12, green); MonoOk.wordWrap = false;
                MonoWarn = Text(mono, 12, amber);
                MonoBad = Text(mono, 12, red); MonoBad.wordWrap = false;
                KeyHint = Text(mono, 13, silver, FontStyle.Bold); KeyHint.wordWrap = false; KeyHint.alignment = TextAnchor.MiddleRight;
                Num = Text(mono, 13, faint, FontStyle.Bold);
                SqOk = Square(green); SqWarn = Square(amber); SqBad = Square(red);
                Close = Text(ui, 24, muted); Close.alignment = TextAnchor.MiddleCenter; Close.wordWrap = false;
                Close.hover.textColor = white;
            }
        }
    }

    // Forwards Unity callbacks to the plugin from an object that survives scene loads.
    public class OverlayRunner : MonoBehaviour
    {
        public OverlayPlugin Owner;
        private void LateUpdate() { if (Owner != null) Owner.Tick(); }
        private void OnGUI() { if (Owner != null) Owner.Gui(); }
    }

    // ---- what the launcher writes (read by MiniJson) -----------------------------
    public class OverlayData
    {
        public string hotkey;
        public string lang;
        public Texts text;
        public ModInfo[] mods;
        public SelfTest selfTest;
        public bool demo;
        public string gameName;
        public string packName;
        public string gameIcon;
        public float opacity;
    }

    public class ModInfo
    {
        public string id;
        public string name;
        public string version;
        public string summary;
        public string image;
        public string[] dlls;
        public Usage usage;
    }

    public class Usage
    {
        public KeyInfo[] keys;
        public string[] steps;
    }

    public class KeyInfo
    {
        public string key;
        public string text;
    }

    public class SelfTest
    {
        public string screenshot;
        public float delaySeconds;
    }

    public class Texts
    {
        public string title, summary, loaded, notLoaded, errors, empty, footer, keys, steps, problems, notLoadedHelp, pack, drag, footerHint;
    }
}
