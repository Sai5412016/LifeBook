import { Image } from 'expo-image';
import * as SplashScreen from 'expo-splash-screen';
import { useState } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import Animated, { Easing, Keyframe } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

const DURATION = 600;

export function AnimatedSplashOverlay() {
  const [animate, setAnimate] = useState(false);
  const [visible, setVisible] = useState(true);

  if (!visible) return null;

  const splashKeyframe = new Keyframe({
    0: {
      transform: [{ scale: 1 }],
      opacity: 1,
    },
    20: {
      opacity: 1,
    },
    70: {
      opacity: 0,
      easing: Easing.elastic(0.7),
    },
    100: {
      opacity: 0,
      transform: [{ scale: 1 }],
      easing: Easing.elastic(0.7),
    },
  });

  const image = <Image style={styles.image} source={require('@/assets/images/expo-logo.png')} />;

  return animate ? (
    <Animated.View
      entering={splashKeyframe.duration(DURATION).withCallback((finished) => {
        'worklet';
        if (finished) {
          scheduleOnRN(setVisible, false);
        }
      })}
      style={styles.splashOverlay}>
      {image}
    </Animated.View>
  ) : (
    <View
      onLayout={() => {
        SplashScreen.hideAsync().finally(() => {
          setAnimate(true);
        });
      }}
      style={styles.splashOverlay}>
      {image}
    </View>
  );
}

/**
 * The three Keyframes below (plus the scale factor derived from
 * `Dimensions.get`) used to be built as module-level `const`s. `Dimensions.get`
 * and `new Keyframe(...)` both call into native/reanimated internals, and ANY
 * call at module scope runs the instant something imports this file — before
 * the root layout has installed its crash handler or rendered its error
 * boundary. Building them lazily, on first use, keeps that risk out of the
 * import chain entirely; each is cached after the first call so behaviour
 * (one shared instance) stays the same as before.
 */
let scaleKeyframe: InstanceType<typeof Keyframe> | null = null;
function getScaleKeyframe(): InstanceType<typeof Keyframe> {
  if (!scaleKeyframe) {
    const initialScaleFactor = Dimensions.get('screen').height / 90;
    scaleKeyframe = new Keyframe({
      0: {
        transform: [{ scale: initialScaleFactor }],
      },
      100: {
        transform: [{ scale: 1 }],
        easing: Easing.elastic(0.7),
      },
    });
  }
  return scaleKeyframe;
}

let logoKeyframe: InstanceType<typeof Keyframe> | null = null;
function getLogoKeyframe(): InstanceType<typeof Keyframe> {
  if (!logoKeyframe) {
    logoKeyframe = new Keyframe({
      0: {
        transform: [{ scale: 1.3 }],
        opacity: 0,
      },
      40: {
        transform: [{ scale: 1.3 }],
        opacity: 0,
        easing: Easing.elastic(0.7),
      },
      100: {
        opacity: 1,
        transform: [{ scale: 1 }],
        easing: Easing.elastic(0.7),
      },
    });
  }
  return logoKeyframe;
}

let glowKeyframe: InstanceType<typeof Keyframe> | null = null;
function getGlowKeyframe(): InstanceType<typeof Keyframe> {
  if (!glowKeyframe) {
    glowKeyframe = new Keyframe({
      0: {
        transform: [{ rotateZ: '0deg' }],
      },
      100: {
        transform: [{ rotateZ: '7200deg' }],
      },
    });
  }
  return glowKeyframe;
}

export function AnimatedIcon() {
  return (
    <View style={styles.iconContainer}>
      <Animated.View entering={getGlowKeyframe().duration(60 * 1000 * 4)} style={styles.glow}>
        <Image style={styles.glow} source={require('@/assets/images/logo-glow.png')} />
      </Animated.View>

      <Animated.View entering={getScaleKeyframe().duration(DURATION)} style={styles.background} />
      <Animated.View style={styles.imageContainer} entering={getLogoKeyframe().duration(DURATION)}>
        <Image style={styles.image} source={require('@/assets/images/expo-logo.png')} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  imageContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  glow: {
    width: 201,
    height: 201,
    position: 'absolute',
  },
  iconContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 128,
    height: 128,
    zIndex: 100,
  },
  image: {
    width: 76,
    height: 71,
  },
  background: {
    borderRadius: 40,
    experimental_backgroundImage: `linear-gradient(180deg, #3C9FFE, #0274DF)`,
    width: 128,
    height: 128,
    position: 'absolute',
  },
  splashOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#208AEF',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
});
