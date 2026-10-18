// A small JSON reader for the session file. Unity's JsonUtility left nested
// arrays empty in some games, so the overlay reads the file itself.
// Produces Dictionary<string, object>, List<object>, string, double, bool or null.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace KitbashOverlay
{
    internal static class MiniJson
    {
        public static object Parse(string text)
        {
            int i = 0;
            object v = Value(text, ref i);
            return v;
        }

        private static void Skip(string s, ref int i)
        {
            while (i < s.Length && char.IsWhiteSpace(s[i])) i++;
        }

        private static object Value(string s, ref int i)
        {
            Skip(s, ref i);
            if (i >= s.Length) throw new FormatException("unexpected end");
            char c = s[i];
            if (c == '{') return Obj(s, ref i);
            if (c == '[') return Arr(s, ref i);
            if (c == '"') return Str(s, ref i);
            if (s.Length - i >= 4 && string.CompareOrdinal(s, i, "true", 0, 4) == 0) { i += 4; return true; }
            if (s.Length - i >= 5 && string.CompareOrdinal(s, i, "false", 0, 5) == 0) { i += 5; return false; }
            if (s.Length - i >= 4 && string.CompareOrdinal(s, i, "null", 0, 4) == 0) { i += 4; return null; }
            int start = i;
            while (i < s.Length && "+-0123456789.eE".IndexOf(s[i]) >= 0) i++;
            if (start == i) throw new FormatException("bad value at " + i);
            return double.Parse(s.Substring(start, i - start), CultureInfo.InvariantCulture);
        }

        private static Dictionary<string, object> Obj(string s, ref int i)
        {
            var d = new Dictionary<string, object>();
            i++;
            Skip(s, ref i);
            if (s[i] == '}') { i++; return d; }
            for (;;)
            {
                Skip(s, ref i);
                string key = Str(s, ref i);
                Skip(s, ref i);
                if (s[i] != ':') throw new FormatException("expected : at " + i);
                i++;
                d[key] = Value(s, ref i);
                Skip(s, ref i);
                if (s[i] == ',') { i++; continue; }
                if (s[i] == '}') { i++; return d; }
                throw new FormatException("expected , or } at " + i);
            }
        }

        private static List<object> Arr(string s, ref int i)
        {
            var l = new List<object>();
            i++;
            Skip(s, ref i);
            if (s[i] == ']') { i++; return l; }
            for (;;)
            {
                l.Add(Value(s, ref i));
                Skip(s, ref i);
                if (s[i] == ',') { i++; continue; }
                if (s[i] == ']') { i++; return l; }
                throw new FormatException("expected , or ] at " + i);
            }
        }

        private static string Str(string s, ref int i)
        {
            if (s[i] != '"') throw new FormatException("expected string at " + i);
            i++;
            var b = new StringBuilder();
            while (i < s.Length)
            {
                char c = s[i++];
                if (c == '"') return b.ToString();
                if (c != '\\') { b.Append(c); continue; }
                char e = s[i++];
                switch (e)
                {
                    case 'n': b.Append('\n'); break;
                    case 't': b.Append('\t'); break;
                    case 'r': b.Append('\r'); break;
                    case 'b': b.Append('\b'); break;
                    case 'f': b.Append('\f'); break;
                    case 'u': b.Append((char)Convert.ToInt32(s.Substring(i, 4), 16)); i += 4; break;
                    default: b.Append(e); break;
                }
            }
            throw new FormatException("unterminated string");
        }

        // ---- mapping onto the session classes ------------------------------------
        private static string S(Dictionary<string, object> d, string k) => d != null && d.TryGetValue(k, out var v) ? v as string : null;
        private static List<object> L(Dictionary<string, object> d, string k) => d != null && d.TryGetValue(k, out var v) ? v as List<object> : null;
        private static Dictionary<string, object> O(Dictionary<string, object> d, string k) => d != null && d.TryGetValue(k, out var v) ? v as Dictionary<string, object> : null;

        public static OverlayData ToData(object root)
        {
            var d = root as Dictionary<string, object>;
            var data = new OverlayData
            {
                hotkey = S(d, "hotkey"),
                lang = S(d, "lang"),
                gameName = S(d, "gameName"),
                packName = S(d, "packName"),
                gameIcon = S(d, "gameIcon"),
                demo = d != null && d.TryGetValue("demo", out var dm) && dm is bool b && b,
            };
            if (d != null && d.TryGetValue("opacity", out var op) && op is double opd) data.opacity = (float)opd;
            var t = O(d, "text");
            data.text = new Texts
            {
                title = S(t, "title"), summary = S(t, "summary"), loaded = S(t, "loaded"), notLoaded = S(t, "notLoaded"),
                errors = S(t, "errors"), empty = S(t, "empty"), footer = S(t, "footer"), keys = S(t, "keys"),
                steps = S(t, "steps"), problems = S(t, "problems"), notLoadedHelp = S(t, "notLoadedHelp"), pack = S(t, "pack"), drag = S(t, "drag"), footerHint = S(t, "footerHint"),
            };
            var st = O(d, "selfTest");
            if (st != null)
            {
                data.selfTest = new SelfTest { screenshot = S(st, "screenshot") };
                if (st.TryGetValue("delaySeconds", out var ds) && ds is double dd) data.selfTest.delaySeconds = (float)dd;
            }
            var mods = new List<ModInfo>();
            foreach (var o in L(d, "mods") ?? new List<object>())
            {
                var m = o as Dictionary<string, object>;
                if (m == null) continue;
                var mi = new ModInfo { id = S(m, "id"), name = S(m, "name"), version = S(m, "version"), summary = S(m, "summary"), image = S(m, "image") };
                var dl = new List<string>();
                foreach (var x in L(m, "dlls") ?? new List<object>()) if (x is string xs) dl.Add(xs);
                mi.dlls = dl.ToArray();
                var u = O(m, "usage");
                var keys = new List<KeyInfo>();
                foreach (var x in L(u, "keys") ?? new List<object>())
                    if (x is Dictionary<string, object> k) keys.Add(new KeyInfo { key = S(k, "key"), text = S(k, "text") });
                var steps = new List<string>();
                foreach (var x in L(u, "steps") ?? new List<object>()) if (x is string xs) steps.Add(xs);
                mi.usage = new Usage { keys = keys.ToArray(), steps = steps.ToArray() };
                mods.Add(mi);
            }
            data.mods = mods.ToArray();
            return data;
        }
    }
}
