package com.biz2success.minvest;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.widget.Toast;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;

/**
 * MInvest: a full-screen WebView around the production web app.
 *  - Only the configured host may be loaded in the WebView. Any other URL is BLOCKED (never handed to a browser/other app).
 *  - No JavaScript bridge is exposed to the page; no plugins are registered.
 *  - CSV export: the web app (when it sees the "MInvestApp" user agent) triggers a data: URL download, which is saved to Downloads here.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onStart() {
        super.onStart();
        final Bridge b = getBridge();
        if (b == null) return;
        b.setWebViewClient(new GuardedClient(b));
        b.getWebView().setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> saveDataUrl(url, contentDisposition, mimeType));
    }

    /** Same-host only: the allowed host comes from the Capacitor config (server.url / allowNavigation), nothing is hard-coded here. */
    private final class GuardedClient extends BridgeWebViewClient {
        GuardedClient(Bridge bridge) { super(bridge); }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            final Uri u = request.getUrl();
            if (isAllowed(u)) return false;            // load inside the app
            runOnUiThread(() -> Toast.makeText(MainActivity.this, "ลิงก์ภายนอกถูกบล็อกเพื่อความปลอดภัย", Toast.LENGTH_SHORT).show());
            return true;                               // blocked: not opened anywhere
        }

        private boolean isAllowed(Uri u) {
            final String scheme = u.getScheme() == null ? "" : u.getScheme();
            final String host = u.getHost() == null ? "" : u.getHost();
            if (host.equals(getBridge().getHost())) return true; // https://localhost (bundled error page)
            final Uri server = Uri.parse(String.valueOf(getBridge().getServerUrl()));
            final String serverHost = server.getHost();
            if (serverHost == null) return false;
            final boolean schemeOk = scheme.equals(server.getScheme()) || scheme.equals("https");
            return schemeOk && host.equalsIgnoreCase(serverHost);
        }
    }

    private void saveDataUrl(String url, String contentDisposition, String mimeType) {
        try {
            if (url == null || !url.startsWith("data:")) {
                toast("ไม่รองรับการดาวน์โหลดรูปแบบนี้");
                return;
            }
            final int comma = url.indexOf(',');
            if (comma < 0) throw new IllegalArgumentException("bad data url");
            final String meta = url.substring(5, comma);
            final String payload = url.substring(comma + 1);
            final byte[] bytes = meta.endsWith(";base64")
                    ? Base64.decode(payload, Base64.DEFAULT)
                    : URLDecoder.decode(payload, "UTF-8").getBytes(StandardCharsets.UTF_8);
            final String mime = (mimeType == null || mimeType.isEmpty()) ? "text/csv" : mimeType.split(";")[0];
            // File name: ";name=" parameter written by the web app, else Content-Disposition, else a safe default. Never derived from the data itself.
            String name = null;
            final java.util.regex.Matcher m1 = java.util.regex.Pattern.compile(";name=([A-Za-z0-9._-]{1,80})").matcher(meta);
            if (m1.find()) name = m1.group(1);
            if (name == null && contentDisposition != null) {
                final java.util.regex.Matcher m2 = java.util.regex.Pattern.compile("filename\\*?=\"?([A-Za-z0-9._-]{1,80})").matcher(contentDisposition);
                if (m2.find()) name = m2.group(1);
            }
            if (name == null) name = "minvest-export.csv";
            if (!name.toLowerCase().endsWith(".csv")) name = name + ".csv";

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                final ContentResolver cr = getContentResolver();
                final ContentValues cv = new ContentValues();
                cv.put(MediaStore.Downloads.DISPLAY_NAME, name);
                cv.put(MediaStore.Downloads.MIME_TYPE, mime);
                cv.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                final Uri item = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                if (item == null) throw new IllegalStateException("insert failed");
                try (OutputStream os = cr.openOutputStream(item)) { os.write(bytes); }
                toast("บันทึกไฟล์แล้วที่ Downloads: " + name);
            } else {
                // API 24-28: no storage permission requested; write to the app's own external Downloads folder.
                final File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                final File f = new File(dir, name);
                try (FileOutputStream os = new FileOutputStream(f)) { os.write(bytes); }
                toast("บันทึกไฟล์แล้ว: " + f.getAbsolutePath());
            }
        } catch (Exception e) {
            toast("บันทึกไฟล์ไม่สำเร็จ");
        }
    }

    private void toast(String m) { runOnUiThread(() -> Toast.makeText(this, m, Toast.LENGTH_LONG).show()); }

    @Override
    public void onCreate(Bundle savedInstanceState) { super.onCreate(savedInstanceState); }
}
