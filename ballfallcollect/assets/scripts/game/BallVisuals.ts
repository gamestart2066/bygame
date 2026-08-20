import { SpriteFrame } from 'cc';
/** Ball Prefab 提供的单一基础球图；实际 Ball 与 ColorBlock Slot 共用。 */
export class BallVisuals {
    private static _baseFrame: SpriteFrame | null = null;

    public static configure(baseFrame: SpriteFrame): void {
        this._baseFrame = baseFrame;
    }

    public static get baseFrame(): SpriteFrame | null {
        return this._baseFrame;
    }

    public static clear(): void {
        this._baseFrame = null;
    }
}
