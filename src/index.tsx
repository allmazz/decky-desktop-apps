import {
    DialogButton,
    Focusable,
    Menu,
    MenuItem,
    PanelSection,
    PanelSectionRow,
    staticClasses,
    showContextMenu,
} from "@decky/ui";
import {
    callable,
    definePlugin,
    toaster,
} from "@decky/api"

import {useEffect, useState} from "react";
import {IoAppsSharp} from "react-icons/io5";
import {FaArrowsRotate, FaEllipsisVertical} from "react-icons/fa6";

import {App, Apps, appsStorage, SortedApps, useSortedApps} from "./apps";
import {createShortcut, openGame, openShortcut, removeShortcut} from "./steam";
import {
    assertBool,
    assertNotNull,
    logger,
    tryOrToast,
    tryOrToastAssert,
} from "./utils";

const getApps = callable<[], Apps>("get_apps");
const setAppSetting = callable<[string, string, boolean | number | string | null], void>("set_app_setting");
const getTemporaryShortcuts = callable<[], number[]>("get_temporary_shortcuts");
const saveTemporaryShortcut = callable<[number], void>("save_temporary_shortcut");
const forgetTemporaryShortcut = callable<[number], void>("forget_temporary_shortcut");


let cleaned = false;


async function fetchApps(prev: SortedApps) {
    const load = async () => {
        const data = await getApps();
        if (prev === appsStorage.getSorted()) // race condition prevention: apps did not change while fetching
            appsStorage.setApps(new Map<string, App>(Object.entries(data)));
        else logger.warn("apps was changed while fetching, this is a race condition");
    }
    await tryOrToast(load, "Failed to fetch apps",);
}

// if steam/decky was killed before temporary shortcuts were deleted, this will delete them.
async function cleanupTemporaryShortcuts() {
    if (cleaned) {
        logger.log("temporary shortcut cleanup is already in progress");
        return;
    }
    cleaned = true;

    const tempShortcuts = await getTemporaryShortcuts();
    if (tempShortcuts.length === 0) {
        logger.log("temporary shortcut cleanup is not required");
        return;
    } else {
        logger.warn("temporary shortcuts found, cleaning up", tempShortcuts);
    }

    for (const appId of tempShortcuts) {
        await tryOrToastAssert(
            removeShortcut,
            "Failed to remove temporary shortcut[cleanup]",
            assertBool,
            appId,
            10000,
        );
        await tryOrToast(forgetTemporaryShortcut, "Failed to forget temporary shortcut[cleanup]", appId);
    }
}

async function trySetAppSettingAndUpdate(
    appId: string,
    key: string,
    value: boolean | number | string | null,
    update: (a: App) => void,
    msg: string = `Failed to update ${key}!`,
) {
    return await tryOrToast(async () => {
        await setAppSetting(appId, key, value);
        appsStorage.updateApp(appId, update);
    }, msg)
}

const AppsSection = ({apps, title, onOpen, onDropdown}: {
    apps: App[],
    title: string,
    onOpen: (app: App) => void,
    onDropdown: (app: App) => void,
}) => {
    if (apps.length === 0) return null;
    return (
        <Focusable style={{paddingBottom: "8px"}}>
            <span className={staticClasses.PanelSectionTitle} style={{padding: "0"}}>{title}</span>
            {
                apps.map(app => (
                        <PanelSectionRow key={app.id}>
                            <Focusable style={{display: "flex", gap: "4px", padding: "4px 0"}}>
                                <DialogButton onClick={() => onOpen(app)}>
                                    {app.name}
                                </DialogButton>
                                <DialogButton
                                    style={{
                                        width: '40px',
                                        minWidth: 0,
                                        padding: '12px 10px',
                                        display: 'flex',
                                        justifyContent: 'center',
                                        alignItems: 'center'
                                    }}
                                    onClick={() => onDropdown(app)}
                                >
                                    <FaEllipsisVertical/>
                                </DialogButton>
                            </Focusable>
                        </PanelSectionRow>
                    )
                )
            }
        </Focusable>
    );
};

function Content() {
    const sortedApps = useSortedApps();
    useEffect(() => {
        if (!sortedApps.loaded)
            fetchApps(sortedApps);
    }, []);

    const open = async (app: App) => {
        // failure here is not a reason to stop opening the app
        await tryOrToast(setAppSetting, "Failed to update last opened time!", app.id, "lastOpened", Date.now());

        if (app.shortcut == null) {
            const res = await tryOrToastAssert(
                createShortcut,
                "Failed to create temporary shortcut!",
                assertNotNull,
                app,
            );
            if (!res.ok) return;

            await tryOrToast(saveTemporaryShortcut, "Failed to save temporary shortcut!", res.result!.appId);

            const cleanup = async () => {
                await tryOrToastAssert(removeShortcut, "Failed to remove temporary shortcut!", assertBool, res.result!.appId);
                await tryOrToast(forgetTemporaryShortcut, "Failed to forget temporary shortcut!", res.result!.appId);
            }
            const res2 = await tryOrToastAssert(
                openGame,
                "Failed to open temporary shortcut!",
                assertBool,
                res.result!.appId,
                res.result!.gameId,
                cleanup
            );
            if (!res2.ok) await cleanup();
        } else {
            await tryOrToastAssert(openShortcut, "Failed to open shortcut!", assertBool, app.shortcut, null);
        }
    }

    const setFavorite = async (appId: string, favorite: boolean) => {
        await trySetAppSettingAndUpdate(appId, "favorite", favorite, a => a.favorite = favorite);
    }

    const setShortcut = async (app: App, add: boolean) => {
        if (add && app.shortcut == null) {
            const res = await tryOrToastAssert(
                createShortcut,
                "Failed to create shortcut!",
                assertNotNull,
                app
            );
            if (!res.ok) return;

            const res2 = await trySetAppSettingAndUpdate(
                app.id, "shortcut", res.result!.appId, a => a.shortcut = res.result!.appId,
            );

            if (res2.ok)
                toaster.toast({title: "Apps", body: "Shortcut created", critical: true});
            else
                await tryOrToastAssert(removeShortcut, "Failed to remove new shortcut!", assertBool, res.result!.appId);
        } else if (!add && app.shortcut != null) {
            await tryOrToastAssert(removeShortcut, "Failed to remove shortcut!", assertBool, app.shortcut);
            await trySetAppSettingAndUpdate(app.id, "shortcut", null, a => a.shortcut = null);
        }
    }

    const setHidden = async (appId: string, hidden: boolean) => {
        await trySetAppSettingAndUpdate(appId, "hidden", hidden, a => a.hidden = hidden);
    }

    const showDropdown = (app: App) => {
        showContextMenu(
            <Menu label={app.name}>
                <MenuItem onClick={() => open(app)}>
                    Open
                </MenuItem>
                <MenuItem onClick={() => setFavorite(app.id, !app.favorite)}>
                    {app.favorite ? "Remove from favorites" : "Add to favorites"}
                </MenuItem>
                <MenuItem onClick={() => setShortcut(app, app.shortcut == null)}>
                    {app.shortcut != null ? "Remove from library" : "Add to library"}
                </MenuItem>
                <MenuItem onClick={() => setHidden(app.id, !app.hidden)}>
                    {app.hidden ? "Unhide" : "Hide"}
                </MenuItem>
            </Menu>
        );
    }

    return (
        <PanelSection>
            <AppsSection apps={sortedApps.favorites} title="Favorites" onOpen={open} onDropdown={showDropdown}/>
            <AppsSection apps={sortedApps.flatpaks} title="Flatpaks" onOpen={open} onDropdown={showDropdown}/>
            <AppsSection apps={sortedApps.apps} title="Apps" onOpen={open} onDropdown={showDropdown}/>
            <AppsSection apps={sortedApps.hidden} title="Hidden" onOpen={open} onDropdown={showDropdown}/>
        </PanelSection>
    );
}

function TitleView() {
    const [disabled, setDisabled] = useState(false);
    return (
        <Focusable style={{display: "flex", padding: 0, width: "100%", justifyContent: "space-between", paddingTop: "4px", paddingBottom: "4px"}}>
            <div className={staticClasses.Title} style={{padding: 0}}>Apps</div>
            <DialogButton
                style={{height: '28px', width: '37px', minWidth: 0, padding: '10px 11px'}}
                disabled={disabled}
                onClick={async () => {
                    setDisabled(true);
                    await fetchApps(appsStorage.getSorted());
                    setDisabled(false);
                }}
            >
                <FaArrowsRotate style={{marginTop: '-4px', display: 'block'}}/>
            </DialogButton>
        </Focusable>
    )
}

export default definePlugin(() => {
    cleanupTemporaryShortcuts();
    return {
        name: "Apps",
        titleView: <TitleView/>,
        content: <Content/>,
        icon: <IoAppsSharp/>,
    };
});
