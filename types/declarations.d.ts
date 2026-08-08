// Ambient module declarations so TypeScript understands CSS imports used by the
// Expo web/react-native-web template. Expo normally generates these into
// expo-env.d.ts on `expo start`; this file makes `tsc --noEmit` pass standalone.

declare module '*.css';

declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}
