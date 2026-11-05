// Each studio ships the app under its own name and IDs. Set these when building, e.g.
//   APP_NAME="Serenity Massage" APP_ID=com.serenitymassage.staff npx eas-cli build
module.exports = ({ config }) => ({
  ...config,
  name: process.env.APP_NAME || config.name,
  ios: { ...config.ios, bundleIdentifier: process.env.APP_ID || config.ios.bundleIdentifier },
  android: { ...config.android, package: process.env.APP_ID || config.android.package },
});
