export const COMMON_PLATFORMS = ['PC', 'PlayStation 5', 'Xbox Series X', 'Switch', 'Switch 2', 'PlayStation 4', 'Xbox One', 'iOS', 'Android'];

const EXCLUDED = new Set([
    'ios', 'android', 'mac', 'linux', 'browser', 'web browser', 'steam vr', 'steamvr',
    'meta quest 2', 'meta quest 3', 'psvr2', 'playstation vr2', 'playstation vr 2',
    'evercade', 'visionos', 'neogeomvs', 'neo geo mvs', 'neogeoaes', 'neo geo aes',
    'zxs', 'zx spectrum', 'oculus quest', 'handheld', 'arduboy',
]);

export function enabledByDefault(platform) {
    return !EXCLUDED.has(platform.toLowerCase());
}

export function orderPlatforms(platforms) {
    return [...new Set(platforms)].sort((a, b) => {
        const rank = p => COMMON_PLATFORMS.includes(p) ? COMMON_PLATFORMS.indexOf(p) : COMMON_PLATFORMS.length;
        return rank(a) - rank(b) || a.localeCompare(b);
    });
}
