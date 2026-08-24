package com.safepass.vault;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.NetworkInfo;
import android.os.Build;
import android.os.Bundle;
import android.widget.Button;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private boolean isErrorShown = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // কাস্টম লেআউট সেট করা (যাতে আপনার তৈরি করা activity_main.xml এবং WebView আইডি সঠিকভাবে কাজ করে)
        setContentView(R.layout.activity_main);

        checkInternetAndLoad();
    }

    private void checkInternetAndLoad() {
        if (!isOnline()) {
            showOfflineScreen();
        } else {
            loadWebPageWithRefresh();
        }
    }

    private void showOfflineScreen() {
        isErrorShown = true;
        setContentView(R.layout.activity_offline);

        Button btnTryAgain = findViewById(R.id.btnTryAgain);
        if (btnTryAgain != null) {
            btnTryAgain.setOnClickListener(v -> recreate());
        }
    }

    private void showSlowNetworkScreen() {
        isErrorShown = true;
        setContentView(R.layout.activity_slow_network);

        Button btnSlowTryAgain = findViewById(R.id.btnSlowTryAgain);
        if (btnSlowTryAgain != null) {
            btnSlowTryAgain.setOnClickListener(v -> recreate());
        }
    }

    private void loadWebPageWithRefresh() {
        // Capacitor-এর ব্রিজের মাধ্যমে WebView লোড করা এবং XML-এর আইডি যুক্ত করা
        if (this.bridge != null && this.bridge.getWebView() != null) {
            WebView webView = this.bridge.getWebView();

            webView.setWebViewClient(new WebViewClient() {
                @Override
                public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                    super.onReceivedError(view, request, error);
                    if (request.isForMainFrame() && !isErrorShown) {
                        showSlowNetworkScreen();
                    }
                }
            });
        }
    }

    private boolean isOnline() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return false;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            android.net.Network network = cm.getActiveNetwork();
            if (network == null) return false;
            NetworkCapabilities capabilities = cm.getNetworkCapabilities(network);
            return capabilities != null && (
                    capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ||
                            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
            );
        } else {
            NetworkInfo netInfo = cm.getActiveNetworkInfo();
            return netInfo != null && netInfo.isConnected();
        }
    }
}