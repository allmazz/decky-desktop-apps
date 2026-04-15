import {toaster} from "@decky/api";
import Logger from "@decky/ui/dist/logger";

export const logger = new Logger("Apps");

type TryOrToastResult<T> = {ok: true, result: T} | {ok: false, result: undefined};
export async function tryOrToast<T, A extends unknown[]>(
    callback: (...args: A) => Promise<T>,
    msg: string,
    ...args: A
): Promise<TryOrToastResult<T>> {
    try {
        return {ok: true, result: await callback(...args)};
    } catch (e) {
        logger.error(msg, e);
        toaster.toast({title: "Apps", body: msg, critical: true});
        return {ok: false, result: undefined};
    }
}
export async function tryOrToastAssert<T, A extends unknown[]>(
    callback: (...args: A) => Promise<T>,
    msg: string,
    assert: (res: T) => boolean,
    ...args: A
): Promise<TryOrToastResult<T>> {
    const res = await tryOrToast(callback, msg, ...args);
    if (res.ok && !assert(res.result)) {
        logger.error(msg, "assertion failed", res)
        toaster.toast({title: "Apps", body: msg, critical: true});
        return {ok: false, result: undefined};
    }

    return res;
}

export const assertBool = (b: boolean)=> b;
export const assertNotNull = (b: any|null|undefined)=> b != null;

export const sleep = (ms: number) => {
    return new Promise(resolve => setTimeout(resolve, ms))
}