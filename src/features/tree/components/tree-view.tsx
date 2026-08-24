/**
 * tree/components/tree-view — the "Baum" (Ahnentafel) view of the
 * Stammbaum: oldest generation at the top, Marina at the bottom center,
 * each row one generation (features/tree/layout.ts). Pan and pinch-zoom
 * via react-native-gesture-handler + react-native-reanimated — both
 * already installed dependencies (CLAUDE.md Fallstrick 5: this adds NO
 * new one, and therefore cannot change the fingerprint). Connector lines
 * are plain rectangles (`View`s with a fixed width or height), no SVG.
 */

import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { initialsForName } from '@/features/people/logic';
import { useSignedUrls } from '@/features/photos/hooks';
import { useUiColors, withAlpha } from '@/ui';

import { computeConnectors, layoutTree, NODE_DIAMETER, type TreeLayoutPerson, type TreeNodePosition } from '../layout';
import { relationLevel, type RelationGraphPerson } from '../logic';
import type { RelativeRow, RelativeUnionRow } from '../types';

/** Warm, dark backdrop behind a deceased person's circle — deliberately fixed, not theme-dependent: the point is contrast against every OTHER (alive) node, not matching light/dark mode. Paired with a small ✝ badge (task requirement: never color alone). */
const DECEASED_BACKDROP = '#4A3428';
const DECEASED_MARK_COLOR = '#F1E4D3';
const BACKDROP_PADDING = 8;

type PositionedPerson = RelativeRow & { partnerIds: string[] };

export function TreeView({
  relatives,
  unions,
  rootId,
  onJumpToList,
}: {
  relatives: RelativeRow[];
  unions: RelativeUnionRow[];
  rootId: string | undefined;
  /** Called when the user taps the "N Personen sind noch nicht verbunden" row — the caller switches back to the list, where every person (connected or not) is always shown. */
  onJumpToList: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const { dangerText } = useUiColors();

  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const startScale = useSharedValue(1);

  const graphPeople: PositionedPerson[] = useMemo(
    () =>
      relatives.map((relative) => ({
        ...relative,
        partnerIds: unions
          .filter((union) => union.a_id === relative.id || union.b_id === relative.id)
          .map((union) => (union.a_id === relative.id ? union.b_id : union.a_id)),
      })),
    [relatives, unions],
  );

  const { positions, connectors, byId, unconnectedCount, rootPosition } = useMemo(() => {
    if (!rootId) {
      return {
        positions: [] as TreeNodePosition[],
        connectors: [] as ReturnType<typeof computeConnectors>,
        byId: new Map<string, PositionedPerson>(),
        unconnectedCount: 0,
        rootPosition: null as TreeNodePosition | null,
      };
    }

    const levelById = new Map<string, number | null>(
      graphPeople.map((person) => [person.id, relationLevel(person as RelationGraphPerson, graphPeople, rootId)]),
    );
    const inTree = graphPeople.filter((person) => levelById.get(person.id) !== null);
    const layoutInput: TreeLayoutPerson[] = inTree.map((person) => ({
      id: person.id,
      level: levelById.get(person.id) as number,
      sort_index: person.sort_index,
      mother_id: person.mother_id,
      father_id: person.father_id,
      partnerIds: person.partnerIds,
    }));

    // rootId anchors the Ahnentafel (layout.ts step 1) — Marina's ancestors
    // get the exact recursive placement, everyone else attaches beside them.
    const computedPositions = layoutTree(layoutInput, rootId);
    return {
      positions: computedPositions,
      connectors: computeConnectors(computedPositions, layoutInput),
      byId: new Map(inTree.map((person) => [person.id, person])),
      unconnectedCount: graphPeople.length - inTree.length,
      rootPosition: computedPositions.find((position) => position.id === rootId) ?? null,
    };
  }, [graphPeople, rootId]);

  const thumbKeys = positions.map((position) => byId.get(position.id)?.photo_key ?? null);
  const signedUrls = useSignedUrls(thumbKeys);

  const bounds = useMemo(() => {
    if (positions.length === 0) {
      return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    }
    return {
      minX: Math.min(...positions.map((p) => p.x)),
      maxX: Math.max(...positions.map((p) => p.x)),
      minY: Math.min(...positions.map((p) => p.y)),
      maxY: Math.max(...positions.map((p) => p.y)),
    };
  }, [positions]);

  const canvasWidth = bounds.maxX - bounds.minX + NODE_DIAMETER + BACKDROP_PADDING * 2 + Spacing.five * 2;
  const canvasHeight = bounds.maxY - bounds.minY + NODE_DIAMETER + BACKDROP_PADDING * 2 + Spacing.five * 2;
  // Every position is shifted so the canvas' own origin sits at (0,0) — the
  // gesture transform below then only ever has to reason about ONE
  // rectangle, not the layout's raw (possibly negative) coordinate range.
  const offsetX = -bounds.minX + Spacing.five;
  const offsetY = -bounds.minY + Spacing.five;

  // `width`/`height`/`rootPosition`/`offsetX`/`offsetY` are plain JS values
  // from THIS render — the gesture objects below are re-created on every
  // render (defined inline in the component body, not memoized), so the
  // worklet closures always capture the current render's values. No
  // `runOnJS` hop needed: `translateX.value = withTiming(...)` etc. are
  // worklet-safe operations on shared values, callable directly inside
  // `.onEnd()`.
  const targetX = rootPosition ? width / 2 - (rootPosition.x + offsetX) : 0;
  const targetY = rootPosition ? height / 2 - (rootPosition.y + offsetY) : 0;

  const pan = Gesture.Pan()
    .onStart(() => {
      startX.value = translateX.value;
      startY.value = translateY.value;
    })
    .onUpdate((event) => {
      translateX.value = startX.value + event.translationX;
      translateY.value = startY.value + event.translationY;
    });

  const pinch = Gesture.Pinch()
    .onStart(() => {
      startScale.value = scale.value;
    })
    .onUpdate((event) => {
      const next = startScale.value * event.scale;
      scale.value = Math.min(Math.max(next, 0.4), 2.5);
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      translateX.value = withTiming(targetX);
      translateY.value = withTiming(targetY);
      scale.value = withTiming(1);
    });

  const composedGesture = Gesture.Simultaneous(pan, pinch, doubleTap);

  // Opens centered on Marina, same target the double-tap reset uses —
  // without this the view would start at the canvas' raw (0,0) corner,
  // usually the oldest generation's edge, not Marina.
  useEffect(() => {
    if (rootPosition) {
      translateX.value = targetX;
      translateY.value = targetY;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootId, rootPosition?.x, rootPosition?.y]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  if (!rootId) {
    return null;
  }

  return (
    <View style={styles.root}>
      <GestureDetector gesture={composedGesture}>
        <View style={styles.viewport}>
          <Animated.View style={[{ width: canvasWidth, height: canvasHeight }, animatedStyle]}>
            {connectors.map((segment, index) => (
              <View
                // eslint-disable-next-line react/no-array-index-key
                key={index}
                style={[
                  styles.connector,
                  {
                    left: segment.x + offsetX,
                    top: segment.y + offsetY,
                    width: segment.width,
                    height: segment.height,
                  },
                ]}
              />
            ))}
            {positions.map((position) => {
              const relative = byId.get(position.id);
              if (!relative) {
                return null;
              }
              const uri = relative.photo_key ? signedUrls.get(relative.photo_key) : undefined;
              return (
                <TreeNode
                  key={position.id}
                  relative={relative}
                  x={position.x + offsetX}
                  y={position.y + offsetY}
                  uri={uri}
                />
              );
            })}
          </Animated.View>
        </View>
      </GestureDetector>

      {unconnectedCount > 0 ? (
        <Pressable onPress={onJumpToList} style={styles.unconnectedRow} hitSlop={8}>
          <ThemedText type="small" themeColor="textSecondary">
            {unconnectedCount === 1
              ? '1 Person ist noch nicht verbunden'
              : `${unconnectedCount} Personen sind noch nicht verbunden`}
          </ThemedText>
          <Text style={[styles.unconnectedLink, { color: dangerText }]}>Zur Liste</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function TreeNode({
  relative,
  x,
  y,
  uri,
}: {
  relative: RelativeRow;
  x: number;
  y: number;
  uri: string | undefined;
}) {
  const { accent } = useUiColors();
  const deceased = Boolean(relative.deceased);
  const name = [relative.given_name, relative.family_name].filter(Boolean).join(' ');

  return (
    <Pressable
      onPress={() => router.push(`/stammbaum/${relative.id}`)}
      style={[styles.node, { left: x - NODE_DIAMETER / 2 - BACKDROP_PADDING, top: y - NODE_DIAMETER / 2 - BACKDROP_PADDING }]}>
      <View
        style={[
          styles.backdrop,
          deceased ? { backgroundColor: DECEASED_BACKDROP } : null,
        ]}>
        <View style={[styles.circle, { borderColor: accent }]}>
          {uri ? (
            <Image source={{ uri }} style={styles.circleImage} contentFit="cover" transition={120} />
          ) : (
            <Text style={styles.initials}>{initialsForName(relative.given_name)}</Text>
          )}
        </View>
        {deceased ? (
          <View style={[styles.deceasedBadge, { backgroundColor: DECEASED_BACKDROP }]}>
            <Text style={styles.deceasedMark}>✝</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.nodeLabel} numberOfLines={2}>
        {name}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  viewport: { flex: 1, overflow: 'hidden' },
  connector: {
    position: 'absolute',
    backgroundColor: withAlpha('#8A7A6A', 0.6),
  },
  node: {
    position: 'absolute',
    width: NODE_DIAMETER + BACKDROP_PADDING * 2,
    alignItems: 'center',
  },
  backdrop: {
    width: NODE_DIAMETER + BACKDROP_PADDING * 2,
    height: NODE_DIAMETER + BACKDROP_PADDING * 2,
    borderRadius: (NODE_DIAMETER + BACKDROP_PADDING * 2) / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circle: {
    width: NODE_DIAMETER,
    height: NODE_DIAMETER,
    borderRadius: NODE_DIAMETER / 2,
    borderWidth: 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EFE6D5',
  },
  circleImage: { width: '100%', height: '100%' },
  initials: { fontSize: 20, fontWeight: '700', color: '#7A6A5E' },
  deceasedBadge: {
    position: 'absolute',
    right: 0,
    bottom: 14,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#FAF3E3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deceasedMark: { color: DECEASED_MARK_COLOR, fontSize: 13, fontWeight: '700' },
  nodeLabel: {
    marginTop: 4,
    fontSize: 11,
    textAlign: 'center',
    color: '#3A2E26',
    width: NODE_DIAMETER + BACKDROP_PADDING * 2 + 16,
  },
  unconnectedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  unconnectedLink: { fontSize: 14, fontWeight: '600' },
});
