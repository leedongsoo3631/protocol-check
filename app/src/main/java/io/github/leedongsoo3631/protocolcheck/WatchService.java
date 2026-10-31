package io.github.leedongsoo3631.protocolcheck;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.SystemClock;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 공유 서버를 몇 초마다 확인해서, 다른 담당자의 도착 체크·채팅을 휴대폰 알림으로 띄운다.
 * 앱 화면이 보이는 동안에는 보드가 직접 알리므로 여기서는 알림을 띄우지 않는다.
 */
public class WatchService extends Service {

    public static volatile boolean appVisible = false;

    static final String CH_RUN = "watch";
    static final String CH_ALERT = "alerts";
    static final String CH_ALERT_QUIET = "alerts_quiet";
    static final int ID_RUN = 1;
    static final long MAX_RUN_MS = 12L * 60 * 60 * 1000;   // 12시간 지나면 스스로 멈춤

    private volatile boolean running = false;
    private Thread worker;
    private int nextId = 100;

    static void start(Context c, String api, String name, boolean vib, boolean snd) {
        SharedPreferences p = c.getSharedPreferences("watch", MODE_PRIVATE);
        p.edit().putString("api", api).putString("name", name)
                .putBoolean("vib", vib).putBoolean("snd", snd).apply();
        Intent i = new Intent(c, WatchService.class);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i);
        else c.startService(i);
    }

    static void stop(Context c) {
        c.stopService(new Intent(c, WatchService.class));
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        channels(this);
    }

    static void channels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        NotificationChannel run = new NotificationChannel(CH_RUN, "실시간 수신 중 표시", NotificationManager.IMPORTANCE_MIN);
        run.setShowBadge(false);
        nm.createNotificationChannel(run);

        NotificationChannel al = new NotificationChannel(CH_ALERT, "도착·채팅 알림", NotificationManager.IMPORTANCE_HIGH);
        al.enableVibration(true);
        al.setVibrationPattern(new long[]{0, 180, 90, 180});
        al.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
                new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build());
        nm.createNotificationChannel(al);

        NotificationChannel q = new NotificationChannel(CH_ALERT_QUIET, "도착·채팅 알림(무음)", NotificationManager.IMPORTANCE_HIGH);
        q.setSound(null, null);
        q.enableVibration(true);
        q.setVibrationPattern(new long[]{0, 180, 90, 180});
        nm.createNotificationChannel(q);
    }

    private PendingIntent openApp() {
        Intent i = new Intent(this, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(this, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && "stop".equals(intent.getAction())) {
            getSharedPreferences("watch", MODE_PRIVATE).edit().putBoolean("off", true).apply();
            stopSelf();
            return START_NOT_STICKY;
        }
        getSharedPreferences("watch", MODE_PRIVATE).edit().putBoolean("off", false).apply();

        Intent stop = new Intent(this, WatchService.class).setAction("stop");
        PendingIntent stopPi = PendingIntent.getService(this, 1, stop, PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(this, CH_RUN)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle("의전 체크 실시간 수신 중")
                .setContentText("다른 담당자의 도착 체크·채팅을 알려 드립니다")
                .setContentIntent(openApp())
                .addAction(new Notification.Action.Builder(null, "알림 끄기", stopPi).build())
                .setOngoing(true)
                .build();
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(ID_RUN, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(ID_RUN, n);
        }

        if (!running) {
            running = true;
            worker = new Thread(this::loop, "watch");
            worker.start();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        if (worker != null) worker.interrupt();
        super.onDestroy();
    }

    @Override
    public void onTimeout(int startId, int fgsType) {
        // 안드로이드 15: 데이터 동기화 서비스 하루 사용 한도에 닿으면 멈춘다
        stopSelf();
    }

    private void loop() {
        long started = SystemClock.elapsedRealtime();
        String ver = "";
        boolean first = true;
        Map<String, Boolean> checked = new HashMap<>();
        long lastSeq = 0;
        int fails = 0;
        while (running) {
            try {
                if (SystemClock.elapsedRealtime() - started > MAX_RUN_MS) {
                    stopSelf();
                    return;
                }
                SharedPreferences p = getSharedPreferences("watch", MODE_PRIVATE);
                String api = p.getString("api", "");
                String me = p.getString("name", "");
                if (api.isEmpty()) {
                    stopSelf();
                    return;
                }
                JSONObject req = new JSONObject();
                req.put("a", "state");
                req.put("ver", ver);
                JSONObject r = new JSONObject(post(api, req.toString()));
                fails = 0;
                if (r.optBoolean("ok") && !r.optBoolean("same")) {
                    ver = r.optString("ver", "");
                    List<String[]> ev = new ArrayList<>();   // {title, text, kind}
                    Map<String, Boolean> now = new HashMap<>();
                    JSONArray ms = r.optJSONArray("members");
                    if (ms != null) {
                        for (int k = 0; k < ms.length(); k++) {
                            JSONObject m = ms.getJSONObject(k);
                            String id = m.optString("id");
                            boolean c = m.optBoolean("checked");
                            now.put(id, c);
                            Boolean was = checked.get(id);
                            if (!first && was != null && was != c) {
                                String who = (m.optString("pos").isEmpty() ? "" : m.optString("pos") + " ") + m.optString("name");
                                String by = m.optString("by");
                                if (c && by.equals(me)) continue;      // 내가 체크한 것
                                ev.add(new String[]{c ? "도착: " + who : "도착 체크 해제: " + who,
                                        c ? m.optString("time") + (by.isEmpty() ? "" : " · " + by + " 체크") : "",
                                        "chk"});
                            }
                        }
                    }
                    long maxSeq = lastSeq;
                    JSONArray cs = r.optJSONArray("chat");
                    if (cs != null) {
                        for (int k = 0; k < cs.length(); k++) {
                            JSONObject c = cs.getJSONObject(k);
                            long s = c.optLong("s");
                            if (s > maxSeq) maxSeq = s;
                            if (!first && s > lastSeq && !c.optString("by").equals(me)) {
                                ev.add(new String[]{"💬 " + c.optString("by"), c.optString("x"), "chat"});
                            }
                        }
                    }
                    checked = now;
                    lastSeq = maxSeq;
                    first = false;
                    if (!ev.isEmpty() && !appVisible) alert(ev, p.getBoolean("vib", true), p.getBoolean("snd", true));
                }
                Thread.sleep(appVisible ? 15000 : 5000);
            } catch (InterruptedException ie) {
                return;
            } catch (Exception e) {
                fails++;
                try {
                    Thread.sleep(Math.min(60000, 5000L * fails));
                } catch (InterruptedException ie) {
                    return;
                }
            }
        }
    }

    private void alert(List<String[]> ev, boolean vib, boolean snd) {
        if (!vib && !snd) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        String ch = snd ? CH_ALERT : CH_ALERT_QUIET;
        if (ev.size() > 3) {
            StringBuilder sb = new StringBuilder();
            for (String[] e : ev) sb.append(e[0]).append(e[1].isEmpty() ? "" : " (" + e[1] + ")").append('\n');
            Notification n = new Notification.Builder(this, ch)
                    .setSmallIcon(R.drawable.ic_stat)
                    .setContentTitle("새 소식 " + ev.size() + "건")
                    .setContentText(ev.get(ev.size() - 1)[0])
                    .setStyle(new Notification.BigTextStyle().bigText(sb.toString().trim()))
                    .setContentIntent(openApp())
                    .setAutoCancel(true)
                    .build();
            nm.notify(nextId++, n);
            return;
        }
        for (String[] e : ev) {
            Notification n = new Notification.Builder(this, ch)
                    .setSmallIcon(R.drawable.ic_stat)
                    .setContentTitle(e[0])
                    .setContentText(e[1])
                    .setStyle(new Notification.BigTextStyle().bigText(e[1]))
                    .setCategory("chat".equals(e[2]) ? Notification.CATEGORY_MESSAGE : Notification.CATEGORY_STATUS)
                    .setContentIntent(openApp())
                    .setAutoCancel(true)
                    .build();
            nm.notify(nextId++, n);
        }
    }

    /** Apps Script 웹 앱은 POST 후 다른 주소로 넘겨주므로 직접 따라간다 */
    static String post(String api, String body) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(api).openConnection();
        c.setInstanceFollowRedirects(false);
        c.setConnectTimeout(15000);
        c.setReadTimeout(20000);
        c.setRequestMethod("POST");
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "text/plain;charset=utf-8");
        try (OutputStream o = c.getOutputStream()) {
            o.write(body.getBytes(StandardCharsets.UTF_8));
        }
        int code = c.getResponseCode();
        String loc = c.getHeaderField("Location");
        if (code >= 300 && code < 400 && loc != null) {
            c.disconnect();
            c = (HttpURLConnection) new URL(new URL(api), loc).openConnection();
            c.setConnectTimeout(15000);
            c.setReadTimeout(20000);
            code = c.getResponseCode();
        }
        if (code != 200) throw new Exception("HTTP " + code);
        try (InputStream in = c.getInputStream()) {
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
            return b.toString("UTF-8");
        } finally {
            c.disconnect();
        }
    }
}
