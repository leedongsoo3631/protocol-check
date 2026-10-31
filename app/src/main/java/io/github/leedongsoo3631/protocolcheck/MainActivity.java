package io.github.leedongsoo3631.protocolcheck;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentValues;
import android.content.Context;
import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.FileProvider;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebViewAssetLoader;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * 의전 체크 — 보드(assets/index.html)를 앱 안에서 실행한다.
 * 사진 선택·공유·갤러리 저장·클립보드·뒤로가기를 휴대폰 기능과 연결한다.
 */
public class MainActivity extends ComponentActivity {

    private static final String HOST = "appassets.androidplatform.net";
    private static final String START = "https://" + HOST + "/assets/index.html";

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private ActivityResultLauncher<Intent> picker;
    private ActivityResultLauncher<String> notifPerm;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 화면 전체 사용 + 상태바/내비게이션바/키보드만큼 여백
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        FrameLayout root = new FrameLayout(this);
        boolean night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        root.setBackgroundColor(night ? 0xFF000000 : 0xFFF2F2F7);
        web = new WebView(this);
        web.setBackgroundColor(night ? 0xFF000000 : 0xFFF2F2F7);
        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets i = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.ime());
            v.setPadding(i.left, i.top, i.right, i.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.setAppearanceLightStatusBars(!night);
        bars.setAppearanceLightNavigationBars(!night);

        // 사진·파일 선택 결과를 보드로 돌려준다
        picker = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
            if (fileCallback == null) return;
            Uri[] uris = null;
            Intent data = result.getData();
            if (result.getResultCode() == RESULT_OK && data != null) {
                ClipData clip = data.getClipData();
                if (clip != null && clip.getItemCount() > 0) {
                    uris = new Uri[clip.getItemCount()];
                    for (int k = 0; k < clip.getItemCount(); k++) uris[k] = clip.getItemAt(k).getUri();
                } else if (data.getData() != null) {
                    uris = new Uri[]{data.getData()};
                }
            }
            fileCallback.onReceiveValue(uris);
            fileCallback = null;
        });

        notifPerm = registerForActivityResult(new ActivityResultContracts.RequestPermission(), granted -> {
            if (!granted) Toast.makeText(this, "알림을 허용해야 화면이 꺼져 있을 때 알림을 받을 수 있습니다", Toast.LENGTH_LONG).show();
        });
        WatchService.channels(this);

        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (HOST.equals(u.getHost())) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Exception ignored) {
                }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                boolean image = false;
                for (String t : params.getAcceptTypes()) {
                    if (t != null && t.startsWith("image")) image = true;
                }
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType(image ? "image/*" : "*/*");
                if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                    i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                }
                try {
                    picker.launch(Intent.createChooser(i, image ? "사진 선택" : "파일 선택"));
                    return true;
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
            }
        });

        web.addJavascriptInterface(new Bridge(), "AndroidBridge");

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(START);

        // 뒤로가기: 열린 창이 있으면 먼저 닫는다
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                web.evaluateJavascript("window.__pcbBack ? window.__pcbBack() : false", value -> {
                    if (!"true".equals(value)) {
                        setEnabled(false);
                        getOnBackPressedDispatcher().onBackPressed();
                        setEnabled(true);
                    }
                });
            }
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        WatchService.appVisible = true;
    }

    @Override
    protected void onPause() {
        WatchService.appVisible = false;
        super.onPause();
    }

    private void askNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            notifPerm.launch(Manifest.permission.POST_NOTIFICATIONS);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }

    private static String safeName(String name) {
        String n = name == null ? "file" : name.replaceAll("[\\\\/:*?\"<>|]", "_");
        return n.isEmpty() ? "file" : n;
    }

    private void shareBytes(byte[] data, String name, String mime) {
        try {
            File dir = new File(getCacheDir(), "share");
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
            File f = new File(dir, safeName(name));
            try (FileOutputStream out = new FileOutputStream(f)) {
                out.write(data);
            }
            Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".files", f);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mime);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(Intent.createChooser(send, "보내기"));
        } catch (Exception e) {
            Toast.makeText(this, "공유하지 못했습니다", Toast.LENGTH_SHORT).show();
        }
    }

    /** 보드 스크립트에서 window.AndroidBridge 로 부른다 */
    private class Bridge {
        @JavascriptInterface
        public void shareImage(String b64, String name) {
            byte[] data = Base64.decode(b64, Base64.DEFAULT);
            runOnUiThread(() -> shareBytes(data, name, "image/jpeg"));
        }

        @JavascriptInterface
        public void shareFile(String b64, String name, String mime) {
            byte[] data = Base64.decode(b64, Base64.DEFAULT);
            runOnUiThread(() -> shareBytes(data, name, mime == null ? "application/octet-stream" : mime));
        }

        /** 갤러리(Pictures/의전체크)에 저장. 안드로이드 10 미만은 false → 보드가 공유로 대신 처리 */
        @JavascriptInterface
        public boolean saveImage(String b64, String name) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false;
            try {
                byte[] data = Base64.decode(b64, Base64.DEFAULT);
                ContentValues v = new ContentValues();
                v.put(MediaStore.Images.Media.DISPLAY_NAME, safeName(name));
                v.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
                v.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/의전체크");
                Uri uri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
                if (uri == null) return false;
                try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                    if (out == null) return false;
                    out.write(data);
                }
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean copyText(String text) {
            try {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                cm.setPrimaryClip(ClipData.newPlainText("의전 체크", text));
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        /** 화면을 보고 있을 때의 알림: 진동 + 알림음 */
        @JavascriptInterface
        public void alert(boolean vib, boolean snd, String kind) {
            runOnUiThread(() -> {
                try {
                    if (vib) {
                        Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
                        long[] pat = "chat".equals(kind) ? new long[]{0, 60, 80, 60} : new long[]{0, 140, 70, 140};
                        if (v != null) v.vibrate(VibrationEffect.createWaveform(pat, -1));
                    }
                    if (snd) {
                        Ringtone r = RingtoneManager.getRingtone(MainActivity.this,
                                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION));
                        if (r != null) r.play();
                    }
                } catch (Exception ignored) {
                }
            });
        }

        /** 화면이 꺼져 있어도 알림 받기 시작. force=false 이면 사용자가 알림에서 끈 상태를 존중한다 */
        @JavascriptInterface
        public void startWatch(String api, String name, boolean vib, boolean snd, boolean force) {
            runOnUiThread(() -> {
                boolean off = getSharedPreferences("watch", MODE_PRIVATE).getBoolean("off", false);
                if (off && !force) {
                    getSharedPreferences("watch", MODE_PRIVATE).edit()
                            .putString("api", api).putString("name", name)
                            .putBoolean("vib", vib).putBoolean("snd", snd).apply();
                    return;
                }
                askNotificationPermission();
                try {
                    WatchService.start(MainActivity.this, api, name, vib, snd);
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "알림 서비스를 시작하지 못했습니다", Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public void stopWatch() {
            runOnUiThread(() -> {
                getSharedPreferences("watch", MODE_PRIVATE).edit().putBoolean("off", true).apply();
                WatchService.stop(MainActivity.this);
            });
        }

        @JavascriptInterface
        public boolean isWatching() {
            return !getSharedPreferences("watch", MODE_PRIVATE).getBoolean("off", false);
        }

        @JavascriptInterface
        public String version() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "";
            }
        }
    }
}
