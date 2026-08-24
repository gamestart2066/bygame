import { _decorator, Component, Label, Node, Tween, tween, Vec3 } from 'cc';
import { CFG } from '../core/GameTypes';
import { ColorBlock } from './ColorBlock';

const { ccclass } = _decorator;

/**
 * ColorBlock 派发器。Prefab 只提供美术节点，本组件由 GameManager 在实例化后挂载。
 * Num(Label) 在 Prefab 中可填正整数；留空时使用 CFG 默认数量。
 */
@ccclass('ColorBlockBoxes')
export class ColorBlockBoxes extends Component {
    private _staged: ColorBlock[] = [];
    private _numLabel: Label | null = null;
    private _dispatching: boolean = false;

    public resolveConfiguredCount(): number {
        const numNode = this.node.getChildByName('Num') ?? this.node.getChildByName('num');
        this._numLabel = numNode?.getComponent(Label) ?? null;
        const configured = Number.parseInt(this._numLabel?.string.trim() ?? '', 10);
        return Number.isInteger(configured) && configured > 0
            ? configured
            : CFG.colorBlockBoxesDefaultCount;
    }

    public setup(staged: ColorBlock[]): void {
        this._staged = staged.slice();
        this._dispatching = false;
        this.redrawCount();
    }

    public dispatchTo(
        targetPosition: Vec3,
        onArrive: (block: ColorBlock) => void,
        canContinue: () => boolean,
    ): boolean {
        if (this._dispatching || this._staged.length <= 0 || !this.node.isValid) return false;
        const block = this._staged.shift();
        if (!block?.isValid) {
            this.redrawCount();
            return false;
        }

        this._dispatching = true;
        this.redrawCount();
        const blockNode = block.node;
        Tween.stopAllByTarget(blockNode);
        blockNode.active = false;
        this.scheduleOnce(() => {
            if (!this.isValid || !block.isValid || !canContinue()) {
                this._dispatching = false;
                if (block.isValid) this._staged.unshift(block);
                this.redrawCount();
                return;
            }
            blockNode.setPosition(this.node.position);
            blockNode.active = true;
            tween(blockNode)
                .to(
                    CFG.colorBlockBoxesDispatchDuration,
                    { position: targetPosition.clone() },
                    { easing: 'quadInOut' },
                )
                .call(() => {
                    this._dispatching = false;
                    if (!this.isValid || !block.isValid) return;
                    if (!canContinue()) {
                        blockNode.active = false;
                        this._staged.unshift(block);
                        this.redrawCount();
                        return;
                    }
                    onArrive(block);
                })
                .start();
        }, CFG.colorBlockBoxesDispatchDelay);
        return true;
    }

    public hasRemaining(): boolean {
        return this._staged.length > 0;
    }

    private redrawCount(): void {
        if (!this._numLabel) {
            const numNode = this.node.getChildByName('Num') ?? this.node.getChildByName('num');
            this._numLabel = numNode?.getComponent(Label) ?? null;
        }
        if (this._numLabel) this._numLabel.string = String(this._staged.length);
    }

    protected onDestroy(): void {
        this.unscheduleAllCallbacks();
        for (const block of this._staged) {
            if (block?.isValid) Tween.stopAllByTarget(block.node);
        }
        this._staged.length = 0;
        this._dispatching = false;
    }
}
