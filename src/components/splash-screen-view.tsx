import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  AccessibilityInfo,
  Animated,
  AppState,
  Easing,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { VideoView, useVideoPlayer } from "expo-video";
import { SafeAreaView } from "react-native-safe-area-context";

// Keep this background in sync with the rendered assets and app.json.
const BACKGROUND = "#F6F4EE";
const dolphinPoster = require("../../assets/images/dolphin-loading.png");
const dolphinLoop = require("../../assets/videos/dolphin-loading.mp4");

type SplashScreenViewProps = {
  isReady: boolean;
  onReady: () => Promise<void>;
  onFinish: () => void;
  durationMs?: number;
};

function subscribeToAppState(onChange: () => void) {
  const subscription = AppState.addEventListener("change", onChange);
  return () => subscription.remove();
}

function useReduceMotion() {
  // Do not start a decoder or decorative animation until the setting resolves.
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    let changed = false;
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (enabled) => {
        changed = true;
        setReduceMotion(enabled);
      },
    );
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active && !changed) setReduceMotion(enabled);
      })
      .catch(() => {
        if (active && !changed) setReduceMotion(true);
      });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

function DolphinLoop({ onError }: { onError: () => void }) {
  const [hasFrame, setHasFrame] = useState(false);
  const player = useVideoPlayer(dolphinLoop, (video) => {
    video.loop = true;
    video.muted = true;
    video.audioMixingMode = "mixWithOthers";
    video.allowsExternalPlayback = false;
    video.keepScreenOnWhilePlaying = false;
    video.staysActiveInBackground = false;
    video.showNowPlayingNotification = false;
  });

  useEffect(() => {
    const subscription = player.addListener("statusChange", ({ status }) => {
      if (status === "error") onError();
    });
    player.play();
    return () => subscription.remove();
  }, [onError, player]);

  // This child unmounts on background, Reduced Motion, failure and completion;
  // useVideoPlayer then releases the native decoder instead of just hiding it.
  return (
    <VideoView
      accessible={false}
      allowsPictureInPicture={false}
      allowsVideoFrameAnalysis={false}
      contentFit="contain"
      fullscreenOptions={{ enable: false }}
      nativeControls={false}
      onFirstFrameRender={() => setHasFrame(true)}
      player={player}
      playsInline
      pointerEvents="none"
      // Android needs a texture for the poster reveal and parent opacity fade.
      // The small, bundled 512px clip limits compositing and decode work.
      surfaceType="textureView"
      useExoShutter={false}
      style={[StyleSheet.absoluteFill, { opacity: hasFrame ? 1 : 0 }]}
    />
  );
}

export function SplashScreenView({
  isReady,
  onReady,
  onFinish,
  durationMs = 1400,
}: SplashScreenViewProps) {
  const { width, height } = useWindowDimensions();
  const modelSize = Math.max(1, Math.min(width - 40, height * 0.42, 360));
  const reduceMotion = useReduceMotion();
  const appState = useSyncExternalStore(
    subscribeToAppState,
    () => AppState.currentState,
    () => "active",
  );
  const isActive = appState === null || appState === "active";
  const [opacity] = useState(() => new Animated.Value(1));
  const [pulse] = useState(() => new Animated.Value(1));
  const [laidOut, setLaidOut] = useState(false);
  const [posterReady, setPosterReady] = useState(false);
  const [posterWaitExpired, setPosterWaitExpired] = useState(false);
  const [presented, setPresented] = useState(false);
  const [minimumElapsed, setMinimumElapsed] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const canPresent = laidOut && (posterReady || posterWaitExpired);
  const canAnimate = presented && isActive && reduceMotion === false;
  const handleVideoError = useCallback(() => setVideoFailed(true), []);

  useEffect(() => {
    // A missing/slow image must never trap users behind the native splash.
    const timer = setTimeout(() => setPosterWaitExpired(true), 500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!canPresent) return;
    let active = true;
    void onReady()
      .catch(() => {})
      .then(() => {
        if (active) setPresented(true);
      });
    return () => {
      active = false;
    };
  }, [canPresent, onReady]);

  useEffect(() => {
    if (!presented || !isActive) return;
    // Count only after the native cover is gone. Never wait for video loading
    // or a full loop, and skip the visual hold when Reduced Motion is enabled.
    const timer = setTimeout(
      () => setMinimumElapsed(true),
      reduceMotion === true ? 0 : durationMs,
    );
    return () => clearTimeout(timer);
  }, [durationMs, isActive, presented, reduceMotion]);

  useEffect(() => {
    if (!minimumElapsed || !isReady || !isActive) return;
    const fade = Animated.timing(opacity, {
      toValue: 0,
      duration: reduceMotion === true ? 0 : 280,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
      isInteraction: false,
    });
    fade.start(({ finished }) => {
      if (finished) onFinish();
    });
    return () => fade.stop();
  }, [isActive, isReady, minimumElapsed, onFinish, opacity, reduceMotion]);

  useEffect(() => {
    if (!canAnimate) return;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.3,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
          isInteraction: false,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
          isInteraction: false,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [canAnimate, pulse]);

  return (
    <Animated.View
      accessibilityLabel="Dolphin. Opening your marketplace."
      accessibilityRole="progressbar"
      accessibilityState={{ busy: true }}
      accessibilityViewIsModal
      accessible
      className="absolute inset-0 z-[99999]"
      onLayout={() => setLaidOut(true)}
      pointerEvents="auto"
      style={{ backgroundColor: BACKGROUND, opacity }}
      testID="dolphin-splash"
    >
      <SafeAreaView className="flex-1 items-center px-5">
        <View className="w-full flex-1 items-center justify-center pb-10">
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{ height: modelSize, width: modelSize }}
          >
            <Image
              accessible={false}
              contentFit="contain"
              onDisplay={() => setPosterReady(true)}
              onError={() => setPosterReady(true)}
              priority="high"
              source={dolphinPoster}
              style={StyleSheet.absoluteFill}
            />
            {canAnimate && !videoFailed ? (
              <DolphinLoop onError={handleVideoError} />
            ) : null}
          </View>
          <Text
            className="mt-1 text-center text-[38px] font-semibold tracking-[-1.8px]"
            style={{ color: "#202321" }}
          >
            Dolphin
          </Text>
          <Text
            className="mt-3 text-center text-[13px] tracking-[0.4px]"
            style={{ color: "#73766E" }}
          >
            Your agents. In motion.
          </Text>
        </View>
        <View className="flex-row items-center justify-center gap-2.5 pb-9 pt-4">
          <Animated.View
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: "#B79142", opacity: canAnimate ? pulse : 1 }}
          />
          <Text
            className="text-[11px] tracking-[0.5px]"
            style={{ color: "#73766E" }}
          >
            Opening your marketplace
          </Text>
        </View>
      </SafeAreaView>
    </Animated.View>
  );
}
