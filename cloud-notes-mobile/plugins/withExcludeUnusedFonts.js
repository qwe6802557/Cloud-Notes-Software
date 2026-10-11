const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Expo Config Plugin: 自动裁剪 @expo/vector-icons 中未使用的字体
 * 项目中仅使用了 Ionicons，排除其他 10+ 套冗余字库以节约 ~4MB APK 体积
 */
module.exports = function withExcludeUnusedFonts(config) {
  return withAppBuildGradle(config, modConfig => {
    if (modConfig.modResults.language === 'groovy') {
      const fontExclusionSnippet = `
// [APK 体积优化] 自动排除未使用的矢量字体，仅保留 Ionicons.ttf
android {
    applicationVariants.all { variant ->
        if (variant.buildType.name == 'release') {
            variant.mergeAssetsProvider.configure {
                doLast {
                    delete(fileTree(dir: outputDir, includes: [
                        'fonts/AntDesign.ttf',
                        'fonts/Entypo.ttf',
                        'fonts/EvilIcons.ttf',
                        'fonts/Feather.ttf',
                        'fonts/FontAwesome*.ttf',
                        'fonts/Fontisto.ttf',
                        'fonts/Foundation.ttf',
                        'fonts/MaterialCommunityIcons.ttf',
                        'fonts/MaterialIcons.ttf',
                        'fonts/Octicons.ttf',
                        'fonts/SimpleLineIcons.ttf',
                        'fonts/Zocial.ttf'
                    ]))
                }
            }
        }
    }
}
`;
      if (!modConfig.modResults.contents.includes('[APK 体积优化] 自动排除未使用的矢量字体')) {
        modConfig.modResults.contents += fontExclusionSnippet;
      }
    }
    return modConfig;
  });
};
