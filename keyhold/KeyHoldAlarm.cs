// 메이플 키 누름 알림
//
// 키보드 키를 오래 누르고 있으면(기본 70초) 알림음을 울린다.
// 메이플스토리 1회 입력 최대 공격 시간 제한에 걸리기 전에 손을 뗐다가 다시 누르도록 알려 주는 용도.
//
// 동작 원리: 0.015초마다 Windows의 GetAsyncKeyState로 "지금 이 키가 눌려 있는가"만 읽는다.
//  - 게임 프로세스를 열거나 메모리를 읽지 않는다.
//  - 키 입력을 보내거나(SendInput) 가로채지(키보드 훅) 않는다.
//  - 게임 창을 찾거나 건드리지 않는다.
// 키보드 상태 표시 프로그램과 같은 방식이며, 입력한 내용은 저장하거나 어디로 보내지 않는다.
//
// Windows에 기본으로 들어 있는 .NET Framework 4의 csc.exe(C# 5)로 빌드되도록
// 최신 문법($"", ?. 등)은 쓰지 않는다. 빌드는 build.bat 참고.

using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Media;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("메이플 키 누름 알림")]
[assembly: System.Reflection.AssemblyProduct("메이플 키 누름 알림")]
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]

namespace KeyHoldAlarm
{
    static class Native
    {
        [DllImport("user32.dll")]
        public static extern short GetAsyncKeyState(int vKey);

        [DllImport("user32.dll")]
        public static extern bool SetProcessDPIAware();
    }

    static class Program
    {
        public const string RestartArg = "--restarted";

        [STAThread]
        static void Main(string[] args)
        {
            bool created;
            using (Mutex mutex = new Mutex(true, "MapleKeyHoldAlarm_SingleInstance", out created))
            {
                if (!created)
                {
                    // 관리자 권한으로 다시 실행한 경우: 이전 창이 닫힐 때까지 잠깐 기다린다.
                    bool restarted = Array.IndexOf(args, RestartArg) >= 0;
                    bool acquired;
                    try { acquired = mutex.WaitOne(restarted ? 5000 : 0); }
                    catch (AbandonedMutexException) { acquired = true; }
                    if (!acquired)
                    {
                        MessageBox.Show("이미 실행 중입니다.", "메이플 키 누름 알림",
                            MessageBoxButtons.OK, MessageBoxIcon.Information);
                        return;
                    }
                }
                try { Native.SetProcessDPIAware(); } catch { }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new MainForm());
                GC.KeepAlive(mutex);
            }
        }
    }

    // ---------------------------------------------------------------- 설정

    class Settings
    {
        public int ThresholdSec = 70;     // 이 시간 이상 누르고 있으면 알림
        public bool Repeat = true;        // 손을 뗄 때까지 반복
        public int RepeatSec = 5;         // 반복 간격
        public int Volume = 70;           // 0~100
        public bool AllKeys = true;       // true: 모든 키, false: 선택한 키만
        public List<int> Keys = new List<int>();
        public bool TopMost = true;

        static string Dir
        {
            get
            {
                return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    "MapleKeyHoldAlarm");
            }
        }

        static string FilePath { get { return Path.Combine(Dir, "settings.ini"); } }

        public static Settings Load()
        {
            Settings s = new Settings();
            try
            {
                if (!File.Exists(FilePath)) return s;
                foreach (string raw in File.ReadAllLines(FilePath, Encoding.UTF8))
                {
                    int eq = raw.IndexOf('=');
                    if (eq <= 0) continue;
                    string k = raw.Substring(0, eq).Trim();
                    string v = raw.Substring(eq + 1).Trim();
                    int n;
                    switch (k)
                    {
                        case "threshold": if (int.TryParse(v, out n)) s.ThresholdSec = Clamp(n, 5, 600); break;
                        case "repeat": s.Repeat = v == "1"; break;
                        case "repeatSec": if (int.TryParse(v, out n)) s.RepeatSec = Clamp(n, 1, 60); break;
                        case "volume": if (int.TryParse(v, out n)) s.Volume = Clamp(n, 0, 100); break;
                        case "allKeys": s.AllKeys = v == "1"; break;
                        case "topMost": s.TopMost = v == "1"; break;
                        case "keys":
                            s.Keys.Clear();
                            foreach (string part in v.Split(','))
                            {
                                if (int.TryParse(part.Trim(), out n) && n > 0 && n < 256 && !s.Keys.Contains(n))
                                    s.Keys.Add(n);
                            }
                            break;
                    }
                }
            }
            catch { }
            return s;
        }

        public void Save()
        {
            try
            {
                Directory.CreateDirectory(Dir);
                List<string> keyStrs = new List<string>();
                foreach (int k in Keys) keyStrs.Add(k.ToString());
                string[] lines = new string[]
                {
                    "threshold=" + ThresholdSec,
                    "repeat=" + (Repeat ? "1" : "0"),
                    "repeatSec=" + RepeatSec,
                    "volume=" + Volume,
                    "allKeys=" + (AllKeys ? "1" : "0"),
                    "keys=" + string.Join(",", keyStrs.ToArray()),
                    "topMost=" + (TopMost ? "1" : "0"),
                };
                File.WriteAllLines(FilePath, lines, new UTF8Encoding(false));
            }
            catch { }
        }

        public static int Clamp(int v, int lo, int hi) { return v < lo ? lo : (v > hi ? hi : v); }
    }

    // ---------------------------------------------------------------- 키 이름

    static class KeyNames
    {
        // Shift/Ctrl/Alt는 왼쪽·오른쪽 구분 코드(0xA0~0xA5)만 쓴다. 통합 코드(0x10~0x12)는 같은 키가 두 번 잡히므로 제외.
        public static bool IsKeyboardKey(int vk)
        {
            if (vk < 0x08 || vk > 0xFE) return false;          // 0x01~0x07: 마우스 버튼 등
            if (vk == 0x10 || vk == 0x11 || vk == 0x12) return false;
            return true;
        }

        public static string Name(int vk)
        {
            if (vk >= 0x41 && vk <= 0x5A) return ((char)vk).ToString();               // A~Z
            if (vk >= 0x30 && vk <= 0x39) return ((char)vk).ToString();               // 0~9
            if (vk >= 0x60 && vk <= 0x69) return "Num " + (vk - 0x60);                // 숫자패드
            if (vk >= 0x70 && vk <= 0x87) return "F" + (vk - 0x70 + 1);               // F1~F24
            switch (vk)
            {
                case 0x08: return "Backspace";
                case 0x09: return "Tab";
                case 0x0D: return "Enter";
                case 0x13: return "Pause";
                case 0x14: return "Caps Lock";
                case 0x15: return "한/영";
                case 0x19: return "한자";
                case 0x1B: return "Esc";
                case 0x20: return "Space";
                case 0x21: return "Page Up";
                case 0x22: return "Page Down";
                case 0x23: return "End";
                case 0x24: return "Home";
                case 0x25: return "←";
                case 0x26: return "↑";
                case 0x27: return "→";
                case 0x28: return "↓";
                case 0x2C: return "Print Screen";
                case 0x2D: return "Insert";
                case 0x2E: return "Delete";
                case 0x5B: return "왼쪽 Windows";
                case 0x5C: return "오른쪽 Windows";
                case 0x5D: return "메뉴";
                case 0x6A: return "Num *";
                case 0x6B: return "Num +";
                case 0x6D: return "Num -";
                case 0x6E: return "Num .";
                case 0x6F: return "Num /";
                case 0x90: return "Num Lock";
                case 0x91: return "Scroll Lock";
                case 0xA0: return "왼쪽 Shift";
                case 0xA1: return "오른쪽 Shift";
                case 0xA2: return "왼쪽 Ctrl";
                case 0xA3: return "오른쪽 Ctrl";
                case 0xA4: return "왼쪽 Alt";
                case 0xA5: return "오른쪽 Alt";
                case 0xBA: return ";";
                case 0xBB: return "=";
                case 0xBC: return ",";
                case 0xBD: return "-";
                case 0xBE: return ".";
                case 0xBF: return "/";
                case 0xC0: return "`";
                case 0xDB: return "[";
                case 0xDC: return "\\";
                case 0xDD: return "]";
                case 0xDE: return "'";
            }
            return "키 0x" + vk.ToString("X2");
        }
    }

    // ---------------------------------------------------------------- 알림음

    static class Beeper
    {
        static SoundPlayer player;      // 재생 중 GC되지 않도록 보관
        static MemoryStream stream;
        static byte[] cache;
        static int cacheVolume = -1;

        public static void Play(int volume)
        {
            if (volume <= 0) return;
            try
            {
                if (cache == null || cacheVolume != volume)
                {
                    cache = MakeWav(volume / 100.0);
                    cacheVolume = volume;
                }
                if (player != null) player.Stop();
                stream = new MemoryStream(cache);
                player = new SoundPlayer(stream);
                player.Play();
            }
            catch
            {
                try { SystemSounds.Exclamation.Play(); } catch { }
            }
        }

        // "삐-삐-삐" 3번. 높은 음 두 개 + 더 높은 음으로 끝나서 게임 효과음과 구분되게.
        static byte[] MakeWav(double gain)
        {
            const int rate = 44100;
            double[][] notes = new double[][]
            {
                // 주파수(Hz), 길이(초), 뒤 쉼(초)
                new double[] { 1318.5, 0.12, 0.06 },
                new double[] { 1318.5, 0.12, 0.06 },
                new double[] { 1760.0, 0.22, 0.00 },
            };
            List<short> samples = new List<short>();
            double amp = 0.9 * gain * gain * 32767.0;    // 볼륨을 제곱해서 귀에 자연스럽게
            foreach (double[] n in notes)
            {
                int len = (int)(n[1] * rate);
                int fade = (int)(0.006 * rate);
                for (int i = 0; i < len; i++)
                {
                    double env = 1.0;
                    if (i < fade) env = (double)i / fade;
                    else if (i > len - fade) env = (double)(len - i) / fade;
                    double t = (double)i / rate;
                    // 사인파 + 약간의 3배음: 작은 스피커에서도 잘 들리게
                    double v = Math.Sin(2 * Math.PI * n[0] * t) * 0.8 + Math.Sin(2 * Math.PI * n[0] * 3 * t) * 0.2;
                    samples.Add((short)(v * env * amp));
                }
                int gap = (int)(n[2] * rate);
                for (int i = 0; i < gap; i++) samples.Add(0);
            }

            MemoryStream ms = new MemoryStream();
            BinaryWriter w = new BinaryWriter(ms);
            int dataBytes = samples.Count * 2;
            w.Write(Encoding.ASCII.GetBytes("RIFF"));
            w.Write(36 + dataBytes);
            w.Write(Encoding.ASCII.GetBytes("WAVE"));
            w.Write(Encoding.ASCII.GetBytes("fmt "));
            w.Write(16);
            w.Write((short)1);          // PCM
            w.Write((short)1);          // 모노
            w.Write(rate);
            w.Write(rate * 2);
            w.Write((short)2);
            w.Write((short)16);
            w.Write(Encoding.ASCII.GetBytes("data"));
            w.Write(dataBytes);
            foreach (short s in samples) w.Write(s);
            w.Flush();
            return ms.ToArray();
        }
    }

    // ---------------------------------------------------------------- 화면

    class MainForm : Form
    {
        readonly Settings settings;
        readonly Stopwatch clock = Stopwatch.StartNew();
        readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();

        readonly bool[] wasDown = new bool[256];
        readonly long[] downSince = new long[256];     // 눌린 시각(ms), 안 눌림이면 -1
        readonly long[] nextAlert = new long[256];     // 다음 알림 시각(ms), 아직 안 울렸으면 0

        bool capturing;
        long captureUntil;

        // 컨트롤
        Label lblKey, lblTime, lblAdmin, lblCount;
        ProgressBar bar;
        Panel statusPanel;
        NumericUpDown numThreshold, numRepeat;
        CheckBox chkRepeat, chkTopMost;
        TrackBar trkVolume;
        Label lblVolume;
        RadioButton rdoAll, rdoSelected;
        ListBox lstKeys;
        Button btnAddKey, btnRemoveKey, btnTest, btnAdmin;

        int alertCount;
        bool loading;

        static readonly Color ColIdle = Color.FromArgb(240, 240, 240);
        static readonly Color ColHold = Color.FromArgb(225, 240, 255);
        static readonly Color ColNear = Color.FromArgb(255, 243, 205);
        static readonly Color ColOver = Color.FromArgb(255, 205, 205);

        public MainForm()
        {
            settings = Settings.Load();
            for (int i = 0; i < 256; i++) downSince[i] = -1;

            BuildUi();
            ApplySettingsToUi();

            timer.Interval = 15;
            timer.Tick += OnTick;
            timer.Start();
        }

        bool IsAdmin()
        {
            try
            {
                WindowsPrincipal p = new WindowsPrincipal(WindowsIdentity.GetCurrent());
                return p.IsInRole(WindowsBuiltInRole.Administrator);
            }
            catch { return false; }
        }

        void BuildUi()
        {
            SuspendLayout();
            Text = "메이플 키 누름 알림";
            Font = new Font("맑은 고딕", 9F);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(380, 520);
            KeyPreview = true;

            int x = 12, w = 356, y = 12;

            // 상태 표시
            statusPanel = new Panel();
            statusPanel.Location = new Point(x, y);
            statusPanel.Size = new Size(w, 112);
            statusPanel.BorderStyle = BorderStyle.FixedSingle;
            statusPanel.BackColor = ColIdle;
            Controls.Add(statusPanel);

            lblKey = new Label();
            lblKey.Location = new Point(8, 8);
            lblKey.Size = new Size(w - 18, 28);
            lblKey.Font = new Font("맑은 고딕", 13F, FontStyle.Bold);
            lblKey.Text = "대기 중";
            statusPanel.Controls.Add(lblKey);

            lblTime = new Label();
            lblTime.Location = new Point(8, 40);
            lblTime.Size = new Size(w - 18, 26);
            lblTime.Font = new Font("맑은 고딕", 12F);
            lblTime.Text = "키를 누르면 시간이 표시됩니다";
            statusPanel.Controls.Add(lblTime);

            bar = new ProgressBar();
            bar.Location = new Point(8, 72);
            bar.Size = new Size(w - 18, 14);
            bar.Maximum = 1000;
            statusPanel.Controls.Add(bar);

            lblCount = new Label();
            lblCount.Location = new Point(8, 89);
            lblCount.Size = new Size(w - 18, 18);
            lblCount.ForeColor = Color.DimGray;
            lblCount.Text = "알림 0회";
            statusPanel.Controls.Add(lblCount);

            y += 112 + 12;

            // 알림 시간
            MakeLabel("알림 시간", x, y + 3, 80);
            numThreshold = new NumericUpDown();
            numThreshold.Location = new Point(x + 84, y);
            numThreshold.Size = new Size(70, 23);
            numThreshold.Minimum = 5;
            numThreshold.Maximum = 600;
            numThreshold.ValueChanged += delegate { OnSettingChanged(); };
            Controls.Add(numThreshold);
            Label l1b = MakeLabel("초 이상 계속 누르면 알림", x + 158, y + 3, 200);
            l1b.ForeColor = Color.DimGray;
            y += 30;

            // 반복
            chkRepeat = new CheckBox();
            chkRepeat.Location = new Point(x, y);
            chkRepeat.Size = new Size(170, 24);
            chkRepeat.Text = "손을 뗄 때까지 반복:";
            chkRepeat.CheckedChanged += delegate { OnSettingChanged(); };
            Controls.Add(chkRepeat);
            numRepeat = new NumericUpDown();
            numRepeat.Location = new Point(x + 174, y);
            numRepeat.Size = new Size(56, 23);
            numRepeat.Minimum = 1;
            numRepeat.Maximum = 60;
            numRepeat.ValueChanged += delegate { OnSettingChanged(); };
            Controls.Add(numRepeat);
            MakeLabel("초마다", x + 234, y + 3, 80);
            y += 32;

            // 볼륨
            MakeLabel("소리 크기", x, y + 6, 80);
            trkVolume = new TrackBar();
            trkVolume.Location = new Point(x + 80, y);
            trkVolume.Size = new Size(170, 30);
            trkVolume.Minimum = 0;
            trkVolume.Maximum = 100;
            trkVolume.TickFrequency = 10;
            trkVolume.SmallChange = 5;
            trkVolume.LargeChange = 10;
            trkVolume.ValueChanged += delegate { lblVolume.Text = trkVolume.Value + "%"; OnSettingChanged(); };
            Controls.Add(trkVolume);
            lblVolume = MakeLabel("70%", x + 252, y + 6, 40);
            btnTest = new Button();
            btnTest.Location = new Point(x + 294, y + 1);
            btnTest.Size = new Size(62, 27);
            btnTest.Text = "테스트";
            btnTest.Click += delegate { Beeper.Play(settings.Volume); };
            Controls.Add(btnTest);
            y += 40;

            // 감시할 키
            GroupBox grp = new GroupBox();
            grp.Location = new Point(x, y);
            grp.Size = new Size(w, 186);
            grp.Text = "감시할 키";
            Controls.Add(grp);

            rdoAll = new RadioButton();
            rdoAll.Location = new Point(10, 20);
            rdoAll.Size = new Size(w - 20, 22);
            rdoAll.Text = "모든 키보드 키";
            rdoAll.CheckedChanged += delegate { OnSettingChanged(); };
            grp.Controls.Add(rdoAll);

            rdoSelected = new RadioButton();
            rdoSelected.Location = new Point(10, 42);
            rdoSelected.Size = new Size(w - 20, 22);
            rdoSelected.Text = "아래 목록의 키만 (예: 공격 키 Ctrl)";
            rdoSelected.CheckedChanged += delegate { OnSettingChanged(); };
            grp.Controls.Add(rdoSelected);

            lstKeys = new ListBox();
            lstKeys.Location = new Point(28, 68);
            lstKeys.Size = new Size(180, 108);
            lstKeys.IntegralHeight = false;
            grp.Controls.Add(lstKeys);

            btnAddKey = new Button();
            btnAddKey.Location = new Point(216, 68);
            btnAddKey.Size = new Size(130, 30);
            btnAddKey.Text = "키 추가";
            btnAddKey.Click += OnAddKeyClick;
            grp.Controls.Add(btnAddKey);

            btnRemoveKey = new Button();
            btnRemoveKey.Location = new Point(216, 104);
            btnRemoveKey.Size = new Size(130, 30);
            btnRemoveKey.Text = "선택한 키 삭제";
            btnRemoveKey.Click += OnRemoveKeyClick;
            grp.Controls.Add(btnRemoveKey);

            y += 186 + 8;

            chkTopMost = new CheckBox();
            chkTopMost.Location = new Point(x, y);
            chkTopMost.Size = new Size(w, 24);
            chkTopMost.Text = "항상 위에 표시";
            chkTopMost.CheckedChanged += delegate { TopMost = chkTopMost.Checked; OnSettingChanged(); };
            Controls.Add(chkTopMost);
            y += 28;

            // 관리자 권한 안내
            bool admin = IsAdmin();
            lblAdmin = new Label();
            lblAdmin.Location = new Point(x, y + 4);
            lblAdmin.Size = new Size(admin ? w : 220, 36);
            lblAdmin.ForeColor = admin ? Color.SeaGreen : Color.DimGray;
            lblAdmin.Text = admin
                ? "관리자 권한으로 실행 중"
                : "게임 중에 키가 안 잡히면\n관리자 권한으로 실행하세요";
            Controls.Add(lblAdmin);
            if (!admin)
            {
                btnAdmin = new Button();
                btnAdmin.Location = new Point(x + 224, y + 2);
                btnAdmin.Size = new Size(132, 36);
                btnAdmin.Text = "관리자 권한으로\n다시 실행";
                btnAdmin.Click += OnRestartAdmin;
                Controls.Add(btnAdmin);
            }
            y += 44;

            ClientSize = new Size(380, y + 4);

            AutoScaleDimensions = new SizeF(96F, 96F);
            AutoScaleMode = AutoScaleMode.Dpi;
            ResumeLayout(false);
            PerformLayout();
        }

        Label MakeLabel(string text, int x, int y, int width)
        {
            Label l = new Label();
            l.Location = new Point(x, y);
            l.AutoSize = true;
            l.MaximumSize = new Size(width, 0);
            l.Text = text;
            Controls.Add(l);
            return l;
        }

        void ApplySettingsToUi()
        {
            loading = true;
            numThreshold.Value = settings.ThresholdSec;
            chkRepeat.Checked = settings.Repeat;
            numRepeat.Value = settings.RepeatSec;
            trkVolume.Value = settings.Volume;
            lblVolume.Text = settings.Volume + "%";
            rdoAll.Checked = settings.AllKeys;
            rdoSelected.Checked = !settings.AllKeys;
            chkTopMost.Checked = settings.TopMost;
            TopMost = settings.TopMost;
            RefreshKeyList();
            loading = false;
            UpdateEnabled();
        }

        void OnSettingChanged()
        {
            if (loading) return;
            settings.ThresholdSec = (int)numThreshold.Value;
            settings.Repeat = chkRepeat.Checked;
            settings.RepeatSec = (int)numRepeat.Value;
            settings.Volume = trkVolume.Value;
            settings.AllKeys = rdoAll.Checked;
            settings.TopMost = chkTopMost.Checked;
            settings.Save();
            UpdateEnabled();
        }

        void UpdateEnabled()
        {
            numRepeat.Enabled = chkRepeat.Checked;
            bool sel = rdoSelected.Checked;
            lstKeys.Enabled = sel;
            btnAddKey.Enabled = sel;
            btnRemoveKey.Enabled = sel;
        }

        void RefreshKeyList()
        {
            lstKeys.Items.Clear();
            foreach (int vk in settings.Keys) lstKeys.Items.Add(KeyNames.Name(vk));
        }

        void OnAddKeyClick(object sender, EventArgs e)
        {
            if (capturing) { StopCapture(); return; }
            capturing = true;
            captureUntil = clock.ElapsedMilliseconds + 10000;
            btnAddKey.Text = "추가할 키를 누르세요";
            btnAddKey.BackColor = ColNear;
        }

        void StopCapture()
        {
            capturing = false;
            btnAddKey.Text = "키 추가";
            btnAddKey.BackColor = SystemColors.Control;
            btnAddKey.UseVisualStyleBackColor = true;
        }

        void OnRemoveKeyClick(object sender, EventArgs e)
        {
            int i = lstKeys.SelectedIndex;
            if (i < 0 || i >= settings.Keys.Count) return;
            settings.Keys.RemoveAt(i);
            settings.Save();
            RefreshKeyList();
        }

        void OnRestartAdmin(object sender, EventArgs e)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(Application.ExecutablePath, Program.RestartArg);
                psi.UseShellExecute = true;
                psi.Verb = "runas";
                settings.Save();
                timer.Stop();
                Process.Start(psi);
                Environment.Exit(0);   // 새 창은 이 프로세스가 끝나기를 기다렸다가 뜬다
            }
            catch (Win32Exception)
            {
                timer.Start();   // 사용자가 UAC 창에서 '아니요'를 누름
            }
        }

        // 키 추가 중에는 누른 키가 버튼을 누르거나(Space/Enter) 메뉴를 여는(Alt) 일이 없도록 삼킨다.
        protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
        {
            if (capturing) return true;
            return base.ProcessCmdKey(ref msg, keyData);
        }

        protected override bool ProcessDialogKey(Keys keyData)
        {
            if (capturing) return true;
            return base.ProcessDialogKey(keyData);
        }

        protected override void OnKeyDown(KeyEventArgs e)
        {
            if (capturing) { e.Handled = true; e.SuppressKeyPress = true; }
            base.OnKeyDown(e);
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            timer.Stop();
            settings.Save();
            base.OnFormClosing(e);
        }

        bool Watched(int vk)
        {
            if (settings.AllKeys) return true;
            return settings.Keys.Contains(vk);
        }

        // ------------------------------------------------------------ 감지

        void OnTick(object sender, EventArgs e)
        {
            long now = clock.ElapsedMilliseconds;
            long thresholdMs = settings.ThresholdSec * 1000L;
            long repeatMs = settings.RepeatSec * 1000L;
            bool alert = false;

            int longestVk = -1;
            long longestMs = -1;
            int heldCount = 0;

            for (int vk = 0x08; vk <= 0xFE; vk++)
            {
                if (!KeyNames.IsKeyboardKey(vk)) continue;
                bool down = (Native.GetAsyncKeyState(vk) & 0x8000) != 0;

                if (capturing && down && !wasDown[vk])
                {
                    if (!settings.Keys.Contains(vk))
                    {
                        settings.Keys.Add(vk);
                        settings.Save();
                        RefreshKeyList();
                    }
                    StopCapture();
                }
                wasDown[vk] = down;

                if (!down || !Watched(vk))
                {
                    downSince[vk] = -1;
                    nextAlert[vk] = 0;
                    continue;
                }

                if (downSince[vk] < 0) downSince[vk] = now;
                long held = now - downSince[vk];
                heldCount++;
                if (held > longestMs) { longestMs = held; longestVk = vk; }

                if (held >= thresholdMs)
                {
                    if (nextAlert[vk] == 0)
                    {
                        alert = true;
                        nextAlert[vk] = settings.Repeat ? now + repeatMs : long.MaxValue;
                    }
                    else if (now >= nextAlert[vk])
                    {
                        alert = true;
                        nextAlert[vk] = now + repeatMs;
                    }
                }
            }

            if (capturing && now > captureUntil) StopCapture();

            if (alert)
            {
                alertCount++;
                lblCount.Text = "알림 " + alertCount + "회";
                Beeper.Play(settings.Volume);
            }

            UpdateStatus(longestVk, longestMs, heldCount, thresholdMs);
        }

        string lastKeyText, lastTimeText;
        Color lastColor;

        void UpdateStatus(int vk, long ms, int heldCount, long thresholdMs)
        {
            string keyText, timeText;
            Color color;
            int barValue;

            if (vk < 0)
            {
                keyText = "대기 중";
                timeText = "키를 누르면 시간이 표시됩니다";
                color = ColIdle;
                barValue = 0;
            }
            else
            {
                keyText = KeyNames.Name(vk) + (heldCount > 1 ? "  외 " + (heldCount - 1) + "개" : "");
                timeText = FormatTime(ms) + " / " + FormatTime(thresholdMs);
                if (ms >= thresholdMs)
                {
                    timeText += "   손 뗐다 다시 누르세요!";
                    color = ColOver;
                }
                else if (ms >= thresholdMs - 10000)
                {
                    color = ColNear;
                }
                else
                {
                    color = ColHold;
                }
                barValue = (int)Math.Min(1000, ms * 1000 / Math.Max(1, thresholdMs));
            }

            if (keyText != lastKeyText) { lblKey.Text = keyText; lastKeyText = keyText; }
            if (timeText != lastTimeText) { lblTime.Text = timeText; lastTimeText = timeText; }
            if (color != lastColor) { statusPanel.BackColor = color; lastColor = color; }
            if (bar.Value != barValue) bar.Value = barValue;
        }

        static string FormatTime(long ms)
        {
            long totalSec = ms / 1000;
            return (totalSec / 60) + ":" + (totalSec % 60).ToString("00");
        }
    }
}
