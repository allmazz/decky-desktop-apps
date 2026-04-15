import {App} from "./apps";
import {logger, sleep} from "./utils";

export const createShortcut = async (app: App) => {
    // this call behaves weirdly and sometimes ignores arguments what can result to inconsistent UI and behavior.
    // let's create the shortcut with dummy properties and correct them later.
    const steamAppId = await SteamClient.Apps.AddShortcut(app.id, app.id, "", "");
    let gameInfo: any|null = null;

    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
        await sleep(100);

        // @ts-ignore
        gameInfo = appStore.GetAppOverviewByAppID(steamAppId);
        if (gameInfo == null) continue;
        if (gameInfo.display_name === app.name) break

        SteamClient.Apps.SetShortcutName(steamAppId, app.name);
        SteamClient.Apps.SetShortcutLaunchOptions(steamAppId, app.cmd);
        SteamClient.Apps.SetShortcutExe(steamAppId, app.bin);
        SteamClient.Apps.SetShortcutStartDir(steamAppId, app.workdir);
        logger.log("shortcut updated", steamAppId, gameInfo);
        await sleep(100);
    }

    if (gameInfo?.display_name !== app.name) {
        console.error("failed to create shortcut: timeout exceeded", steamAppId, gameInfo);
        await removeShortcut(steamAppId);
        return null;
    }

    logger.log("shortcut created", steamAppId, gameInfo);
    return {appId: steamAppId, gameId: gameInfo.m_gameid};
};

export const openShortcut = (
    appId: number,
    onClosed: (() => void)|null,
) => {
    // @ts-ignore
    const game = appStore.GetAppOverviewByAppID(appId);
    if (game == null) throw new Error(`App ${appId} not found`);

    logger.log("game found", appId, game);
    return openGame(appId, game.m_gameid, onClosed);
};

export const openGame = (
    appId: number,
    gameId: string,
    onClosed: (() => void)|null,
) => {
    return new Promise<boolean>((resolve, reject) => {
        let resolved = false;
        let closed = false;
        let timer: number|null = null;

        const runStarted = Date.now();
        const sub = SteamClient.GameSessions.RegisterForAppLifetimeNotifications((e) => {
            if (e.unAppID == appId) {
                if (!resolved && e.bRunning) {
                    resolved = true;

                    logger.log(`game opened in ${Date.now() - runStarted}ms`, appId, gameId);
                    if (timer !== null) clearTimeout(timer);
                    if (onClosed === null) sub?.unregister();

                    resolve(true);
                }
                if (!e.bRunning && !closed && onClosed !== null) {
                    closed = true;

                    logger.log("game closed", appId, gameId);
                    sub?.unregister();

                    onClosed();
                }
            }
        });

        try {
            SteamClient.Apps.RunGame(gameId, "", -1, 100);
            logger.log("requested RunGame", appId, gameId);
        } catch (e) {
            if (resolved) return;
            resolved = true;
            sub?.unregister();
            reject(e);
            return;
        }

        timer = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                logger.error("game has not been opened in timeout!", appId, gameId);
                sub?.unregister();
                resolve(false);
            } else {
                logger.warn("timeout fired after promise was already resolved. was it cleaned up properly?");
            }
        }, 5000);
    })
};

export const removeShortcut = async (appId: number, timeout: number = 2000) => {
    const start = Date.now();
    const deadline = start + timeout;

    let waiting_store = false;
    while (Date.now() < deadline) {
        // @ts-ignore
        if (!appStore?.m_bIsInitialized || (appStore.m_mapApps?.data_?.size ?? 0) === 0) {
            if (!waiting_store) {
                waiting_store = true;
                // @ts-ignore
                logger.log("app store is not initialized yet, waiting", appStore);
            }

            await sleep(300);
            continue;
        } else if (waiting_store) {
            waiting_store = false;
            // @ts-ignore
            logger.log("app store is initialized, continuing", appStore);
        }

        try {
            SteamClient.Apps.RemoveShortcut(appId);
        } catch (e) {
            logger.error("failed to remove shortcut", appId, e);
            return false;
        }

        await sleep(100);

        try {
            // @ts-ignore
            const game = appStore.GetAppOverviewByAppID(appId);
            if (game == null) {
                logger.log(`shortcut removed in ${Date.now() - start}ms`, appId);
                return true;
            }

            logger.log("shortcut still exists", appId, game);
            await sleep(500);
        } catch (e) {
            logger.error("failed to get app overview after removal", appId, e);
            return false;
        }
    }

    logger.error("failed to remove shortcut in timeout", appId);
    return false;
};