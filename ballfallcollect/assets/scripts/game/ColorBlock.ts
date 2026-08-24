import {
    _decorator, Component, Node, Sprite, UITransform, Vec3, Color, EventTouch, Tween, tween, Label,
    LabelOutline,
} from 'cc';
import { BallColor, CFG, getColor } from '../core/GameTypes';
import { BallVisuals } from './BallVisuals';
import { ColorBlockType } from '../config/LevelConfig';

const { ccclass, property } = _decorator;

/**
 * 顶部彩色格子。
 *
 * 职责边界（重要）：
 * - 节点大小来自 Prefab；数量与网格位置由 LevelGrids.json + Startgridpos 在运行时生成
 * - 颜色由 GameManager 在运行时通过 setup() 分配（用户无需在编辑器配色）
 * - 每个格子固定产出 CFG.ballsPerBlock（9）个同色球
 *
 * 玩家的唯一操作对象：点击后逐个释放内部小球；不点击则不释放。
 */
@ccclass('ColorBlock')
export class ColorBlock extends Component {
    @property({ tooltip: '仅供调试查看，运行时由 GameManager 分配，勿手动依赖' })
    public colorId: BallColor = BallColor.Red;

    public blockIndex: number = 0;
    public blockType: ColorBlockType = ColorBlockType.Normal;
    /** 从初始可点击格到本格的最短解锁层级；1 表示可直接点击。 */
    public path: number = 1;

    /** 剩余未释放的球数 */
    public remaining: number = CFG.ballsPerBlock;

    private _releasing: boolean = false;
    /** 本关是否至少成功触发过一次点击释放。 */
    private _hasBeenClicked: boolean = false;
    /** 是否已由网格解锁；锁定时触摸不生效并显示 Lid。 */
    private _clickEnabled: boolean = false;
    private _background: Node | null = null;
    private _slotsRoot: Node | null = null;
    private _bgSprite: Sprite | null = null;
    /** Prefab 中 Background 的原始颜色，Unknown 揭示前保持该色而不赋玩法颜色。 */
    private _bgBaseColor: Color = new Color(255, 255, 255, 255);
    private _lid: Node | null = null;
    private _lidSprite: Sprite | null = null;
    private _unknown: Node | null = null;
    /** Unknown 解锁前不允许实际颜色节点泄露。 */
    private _typeRevealed: boolean = true;
    private _baseScale: Vec3 = new Vec3(1, 1, 1);
    private _lidBaseScale: Vec3 = new Vec3(1, 1, 1);
    private _slotNodes: Node[] = [];
    private _slotSprites: Sprite[] = [];
    private _slotPositions: Vec3[] = [];
    private _slotScales: Vec3[] = [];
    private _initialized: boolean = false;
    private _releaseToken: number = 0;
    /** 下一颗尚未启动展示动画的 Slot；与 remaining 分离，允许多个 Tween 并行。 */
    private _nextSlotIndex: number = -1;
    private _pendingReleases: number = 0;
    /** 展示球动画结束后的回调：(color, 动画终点世界坐标) */
    private _onRelease: ((color: BallColor, spawnWorldPos: Vec3) => boolean) | null = null;
    private _onActivated: ((blockIndex: number) => void) | null = null;
    private _onDepleted: ((blockIndex: number) => void) | null = null;
    private _canActivate: (() => boolean) | null = null;

    /**
     * 由 GameManager 在扫描到本格子后调用，分配颜色并激活。
     * 未调用 setup 的格子不会响应点击。
     */
    public setup(
        color: BallColor,
        index: number,
        path: number,
        blockType: ColorBlockType,
        onRelease: (color: BallColor, spawnWorldPos: Vec3) => boolean,
        onActivated: (blockIndex: number) => void,
        canActivate: () => boolean,
        onDepleted?: (blockIndex: number) => void,
    ): void {
        this.colorId = color;
        this.blockIndex = index;
        this.path = Math.max(1, Math.floor(path));
        this.blockType = blockType;
        this._typeRevealed = blockType !== ColorBlockType.Unknown;
        this.remaining = CFG.ballsPerBlock;
        this._nextSlotIndex = this.remaining - 1;
        this._pendingReleases = 0;
        this._hasBeenClicked = false;
        this._clickEnabled = false;
        this._onRelease = onRelease;
        this._onActivated = onActivated;
        this._canActivate = canActivate;
        this._onDepleted = onDepleted ?? null;
        this._initialized = true;
        this.showPathDebug();

        this._background = this.node.getChildByPath('Background');
        if (this._background) {
            this._bgSprite = this._background.getComponent(Sprite) ?? this._background.addComponent(Sprite);
            this._bgBaseColor = this._bgSprite.color.clone();
        } else {
            console.warn('[ColorBlock] 未找到 Background 子节点，背景将不会染色。');
        }

        this._lid = this.node.getChildByName('Lid');
        this._lidSprite = this._lid?.getComponent(Sprite) ?? null;
        this._baseScale = this.node.scale.clone();
        this._lidBaseScale = this._lid?.scale.clone() ?? new Vec3(1, 1, 1);
        if (!this._lid || !this._lidSprite) {
            console.warn('[ColorBlock] 未找到 Lid(Sprite)，锁定遮罩将无法显示。');
        }

        this._unknown = this.node.getChildByName('Unknown');
        if (this.blockType === ColorBlockType.Unknown && !this._unknown) {
            console.error('[ColorBlock] unknown 类型要求 Prefab 根节点包含 Unknown 子节点。');
        }

        this._slotsRoot = this.node.getChildByPath('Slots');
        this._slotNodes = this._slotsRoot ? this._slotsRoot.children.slice() : [];
        this._slotSprites = this._slotNodes
            .map((n) => n.getComponent(Sprite))
            .filter((s): s is Sprite => !!s);
        this._slotPositions = this._slotNodes.map((n) => n.position.clone());
        this._slotScales = this._slotNodes.map((n) => n.scale.clone());
        if (this._slotNodes.length < CFG.ballsPerBlock) {
            console.error(
                `[ColorBlock] Slots 只有 ${this._slotNodes.length} 个实体节点，` +
                `少于 CFG.ballsPerBlock=${CFG.ballsPerBlock}；不会动态补建节点。`
            );
        }
        if (this._slotSprites.length !== this._slotNodes.length) {
            console.error('[ColorBlock] 部分 Slot 没有 Sprite 组件；不会动态补挂。');
        }

        this.redraw();

        this.node.off(Node.EventType.TOUCH_END, this.onTouch, this);
        this.node.on(Node.EventType.TOUCH_END, this.onTouch, this);
    }

    /** 临时关卡调试：在每个 ColorBlock 顶层显示最短解锁 path。 */
    private showPathDebug(): void {
        let debugNode = this.node.getChildByName('PathDebug');
        if (!CFG.debugShowColorBlockPath) {
            if (debugNode) debugNode.active = false;
            return;
        }
        if (!debugNode) {
            debugNode = new Node('PathDebug');
            debugNode.setParent(this.node);
            const ui = debugNode.addComponent(UITransform);
            ui.setContentSize(90, 40);
            const label = debugNode.addComponent(Label);
            label.fontSize = 30;
            label.lineHeight = 34;
            label.color = new Color(255, 255, 255, 255);
            const outline = debugNode.addComponent(LabelOutline);
            outline.color = new Color(0, 0, 0, 255);
            outline.width = 3;
        }
        const label = debugNode.getComponent(Label);
        if (label) label.string = `P${this.path}`;
        debugNode.setPosition(0, 0, 0);
        debugNode.setSiblingIndex(this.node.children.length - 1);
        debugNode.active = true;
    }

    private onTouch(_e: EventTouch): void {
        this.startRelease();
    }

    /** 开始释放：逐球间隔投放，避免同帧重叠导致物理爆炸 */
    public startRelease(): void {
        if (!this._initialized || !this._clickEnabled || this._releasing || this.remaining <= 0) return;
        if (this._canActivate && !this._canActivate()) return;
        this._hasBeenClicked = true;
        const activated = this._onActivated;
        if (activated) activated(this.blockIndex);
        this._releasing = true;
        this._releaseToken++;
        this.startNextDisplayRelease(this._releaseToken);
    }

    /** 只负责按 releaseInterval 启动动画，不等待上一颗 Tween 完成。 */
    private startNextDisplayRelease(token: number): void {
        if (token !== this._releaseToken || !this._releasing) return;
        if (this._nextSlotIndex < 0) {
            if (this._pendingReleases <= 0) this._releasing = false;
            return;
        }

        const slotIndex = this._nextSlotIndex--;
        this._pendingReleases++;
        this.animateDisplayRelease(slotIndex, token);

        if (this._nextSlotIndex >= 0) {
            if (CFG.releaseInterval <= 0) {
                // scheduleOnce(0) 仍会延后到后续调度帧；0 间隔必须在本帧直接启动。
                this.startNextDisplayRelease(token);
            } else {
                this.scheduleOnce(
                    () => this.startNextDisplayRelease(token),
                    CFG.releaseInterval
                );
            }
        }
    }

    private animateDisplayRelease(slotIndex: number, token: number): void {
        if (this.remaining <= 0) {
            this._releasing = false;
            this.redraw();
            return;
        }

        const slot = this._slotNodes[slotIndex];
        if (!slot) {
            console.error(`[ColorBlock] 找不到待释放的 Slot index=${slotIndex}。`);
            this.abortReleaseBatch();
            return;
        }

        const originPos = this._slotPositions[slotIndex] ?? slot.position.clone();
        const originScale = this._slotScales[slotIndex] ?? slot.scale.clone();
        // 这是实际 Ball 出现前的完整展示动画，不受 releaseInterval 截短。
        const duration = Math.max(0, CFG.slotReleaseDuration);
        const liftDuration = duration * 0.35;
        const dropDuration = duration - liftDuration;
        // 以 Slot 在 ColorBlock 内的局部 X 判断向外方向：左列向左、右列向右、
        // 中列保持竖直。终点保留外扩，使较大的真实 Ball 出生时更分散。
        const directionX = originPos.x < -1 ? -1 : originPos.x > 1 ? 1 : 0;
        const outwardX = directionX * CFG.slotReleaseOutwardDistance;
        const liftPos = new Vec3(
            originPos.x + outwardX * 0.55,
            originPos.y + CFG.slotReleaseLiftDistance,
            originPos.z
        );
        const targetPos = new Vec3(
            originPos.x + outwardX,
            originPos.y - CFG.slotReleaseDropDistance,
            originPos.z
        );
        const liftScale = new Vec3(
            originScale.x * (1 + (CFG.ballVisualScale - 1) * 0.35),
            originScale.y * (1 + (CFG.ballVisualScale - 1) * 0.35),
            originScale.z
        );
        const targetScale = new Vec3(
            originScale.x * CFG.ballVisualScale,
            originScale.y * CFG.ballVisualScale,
            originScale.z
        );

        Tween.stopAllByTarget(slot);
        slot.active = true;
        slot.setPosition(originPos);
        slot.setScale(originScale);
        tween(slot)
            .to(liftDuration, { position: liftPos, scale: liftScale }, { easing: 'quadOut' })
            .to(dropDuration, { position: targetPos, scale: targetScale }, { easing: 'quadIn' })
            .call(() => this.finishDisplayRelease(slotIndex, token))
            .start();
    }

    private finishDisplayRelease(slotIndex: number, token: number): void {
        if (token !== this._releaseToken || !this._releasing) return;
        const slot = this._slotNodes[slotIndex];
        if (!slot?.isValid) {
            this.abortReleaseBatch();
            return;
        }

        // 先记录动画终点，再隐藏展示球；真实 Ball 随后在同一点出现。
        const spawnWorldPos = this.getSlotWorldPos(slotIndex);
        slot.active = false;
        const spawned = this._onRelease?.(this.colorId, spawnWorldPos) ?? false;
        if (!spawned) {
            // Pause / GameOver / Pool 未就绪：整批失效，恢复所有尚未消费的展示球。
            this.abortReleaseBatch();
            return;
        }

        this.remaining--;
        this._pendingReleases--;
        this.restoreSlot(slotIndex, false);
        this.redrawBackground();

        if (this.remaining <= 0 || (this._nextSlotIndex < 0 && this._pendingReleases <= 0)) {
            this._releasing = false;
            if (this.remaining <= 0) this._onDepleted?.(this.blockIndex);
        }
    }

    private abortReleaseBatch(): void {
        this.unscheduleAllCallbacks();
        this._releaseToken++;
        this._releasing = false;
        this._pendingReleases = 0;
        this._nextSlotIndex = this.remaining - 1;
        for (let i = 0; i < this._slotNodes.length; i++) {
            this.restoreSlot(i, i < this.remaining);
        }
    }

    private restoreSlot(index: number, visible: boolean): void {
        const slot = this._slotNodes[index];
        if (!slot) return;
        Tween.stopAllByTarget(slot);
        slot.setPosition(this._slotPositions[index] ?? new Vec3(0, 0, 0));
        slot.setScale(this._slotScales[index] ?? new Vec3(1, 1, 1));
        slot.active = visible;
    }

    /** Slot 当前锚点的世界坐标；释放动画终点由此转换为真实 Ball 出生点。 */
    public getSlotWorldPos(index: number): Vec3 {
        const node = this._slotNodes[index];
        const ui = node?.getComponent(UITransform);
        if (ui) return ui.convertToWorldSpaceAR(new Vec3(0, 0, 0));
        if (node) return node.worldPosition.clone();
        return this.getBlockWorldPos();
    }

    /** 兜底：槽位节点缺失时退回格子底边中心。 */
    private getBlockWorldPos(): Vec3 {
        const ui = this.getComponent(UITransform);
        const h = ui ? ui.contentSize.height : CFG.blockHeight;
        const anchorY = ui ? ui.anchorY : 0.5;

        const anchorX = ui ? ui.anchorX : 0.5;
        return ui
            ? ui.convertToWorldSpaceAR(new Vec3((0.5 - anchorX) * ui.contentSize.width, -anchorY * h, 0))
            : this.node.worldPosition.clone();
    }

    public isEmpty(): boolean {
        return this.remaining <= 0;
    }

    public isInitialized(): boolean {
        return this._initialized;
    }

    public hasBeenClicked(): boolean {
        return this._hasBeenClicked;
    }

    /** 所有类型 ColorBlock 共用的耗尽退场：先缩小，再隐藏根节点。 */
    public playDepleteAndHide(): void {
        if (!this.node.isValid || !this.node.active) return;
        Tween.stopAllByTarget(this.node);
        tween(this.node)
            .to(
                CFG.colorBlockDepleteDuration,
                { scale: new Vec3(0, 0, this._baseScale.z) },
                { easing: 'quadIn' },
            )
            .call(() => {
                if (!this.node.isValid) return;
                this.node.active = false;
                this.node.setScale(this._baseScale);
            })
            .start();
    }

    public setClickEnabled(enabled: boolean): void {
        if (this._clickEnabled === enabled) {
            this.redrawLid();
            return;
        }
        this._clickEnabled = enabled;
        if (enabled) {
            this.revealBlockType();
            this.playUnlockTweens();
        }
        else this.restoreLockedVisual();
    }

    /** Unknown 只隐藏信息；解锁后恢复为标准 ColorBlock 的完整流程。 */
    private revealBlockType(): void {
        if (this._typeRevealed) return;
        this._typeRevealed = true;
        if (this._unknown) this._unknown.active = false;
        if (this._slotsRoot) this._slotsRoot.active = true;
        this.redrawBackground();
        this.redrawDots();
        this.redrawLidColor();
    }

    /** 解锁时并行播放：格子脉冲 + Lid 缩小消失。 */
    private playUnlockTweens(): void {
        Tween.stopAllByTarget(this.node);
        this.node.setScale(this._baseScale);
        const pulse = CFG.colorBlockUnlockPulseScale;
        const halfDuration = CFG.colorBlockUnlockPulseDuration * 0.5;
        tween(this.node)
            .to(halfDuration, {
                scale: new Vec3(
                    this._baseScale.x * pulse,
                    this._baseScale.y * pulse,
                    this._baseScale.z,
                ),
            }, { easing: 'quadOut' })
            .to(halfDuration, { scale: this._baseScale.clone() }, { easing: 'quadIn' })
            .start();

        if (!this._lid) return;
        Tween.stopAllByTarget(this._lid);
        this.redrawLidColor();
        this._lid.setScale(this._lidBaseScale);
        this._lid.active = true;
        tween(this._lid)
            .to(CFG.colorBlockLidHideDuration, {
                scale: new Vec3(0, 0, this._lidBaseScale.z),
            }, { easing: 'quadIn' })
            .call(() => {
                if (!this._lid?.isValid || !this._clickEnabled) return;
                this._lid.active = false;
                this._lid.setScale(this._lidBaseScale);
            })
            .start();
    }

    private restoreLockedVisual(): void {
        Tween.stopAllByTarget(this.node);
        this.node.setScale(this._baseScale);
        if (!this._lid) return;
        Tween.stopAllByTarget(this._lid);
        this._lid.setScale(this._lidBaseScale);
        this.redrawLidColor();
        this._lid.active = true;
    }

    /** 更新格子：只使用 Prefab 中已有的 Background 与 Slot Sprite。 */
    private redraw(): void {
        const concealed = this.blockType === ColorBlockType.Unknown && !this._typeRevealed;
        if (this._unknown) this._unknown.active = concealed;
        if (this._background) this._background.active = true;
        if (this._slotsRoot) this._slotsRoot.active = !concealed;
        this.redrawBackground();
        this.redrawDots();
        this.redrawLid();
    }

    /** 背景染色：直接设置 Background 节点上 Sprite 的颜色，不再用 Graphics 计算绘制 */
    private redrawBackground(): void {
        if (!this._bgSprite) return;

        if (this.blockType === ColorBlockType.Unknown && !this._typeRevealed) {
            this._bgSprite.color = this._bgBaseColor.clone();
            return;
        }

        const empty = this.isEmpty();
        const base = getColor(this.colorId);
        this._bgSprite.color = empty
            ? new Color(base.r * 0.35, base.g * 0.35, base.b * 0.35, this._bgSprite.color.a)
            : new Color(base.r, base.g, base.b, this._bgSprite.color.a);
    }

    /** Slot Sprite 就是格子内尚未释放的球；SpriteFrame 与实际 Ball 共用 BallVisuals。 */
    private redrawDots(): void {
        const base = getColor(this.colorId);
        for (let i = 0; i < this._slotNodes.length; i++) {
            const visible = i < this.remaining;
            this._slotNodes[i].active = visible;
            const sprite = this._slotNodes[i].getComponent(Sprite);
            if (sprite) {
                sprite.spriteFrame = BallVisuals.baseFrame;
                sprite.color = new Color(base.r, base.g, base.b, 255);
            }
        }
    }

    /** Lid 使用本格颜色；锁定时显示，解锁后隐藏。 */
    private redrawLid(): void {
        if (!this._lid) return;
        this.redrawLidColor();
        if (!this._clickEnabled) {
            this._lid.setScale(this._lidBaseScale);
            this._lid.active = true;
        } else if (!this._lid.active) {
            this._lid.active = false;
        }
    }

    private redrawLidColor(): void {
        if (this.blockType === ColorBlockType.Unknown && !this._typeRevealed) {
            if (this._lidSprite) this._lidSprite.color = new Color(255, 255, 255, 255);
            return;
        }
        const base = getColor(this.colorId);
        if (this._lidSprite) {
            this._lidSprite.color = new Color(base.r, base.g, base.b, this._lidSprite.color.a);
        }
    }

    /** 胜负、Restart 或销毁前取消尚未执行的逐球释放。 */
    public stopRelease(): void {
        this.unscheduleAllCallbacks();
        Tween.stopAllByTarget(this.node);
        if (this._lid) Tween.stopAllByTarget(this._lid);
        this.node.setScale(this._baseScale);
        if (this._lid?.isValid) this._lid.setScale(this._lidBaseScale);
        this._releaseToken++;
        this._releasing = false;
        this._pendingReleases = 0;
        this._nextSlotIndex = this.remaining - 1;
        this._onRelease = null;
        this._onActivated = null;
        this._canActivate = null;
        this._onDepleted = null;
        for (let i = 0; i < this._slotNodes.length; i++) {
            this.restoreSlot(i, i < this.remaining);
        }
        this.node.off(Node.EventType.TOUCH_END, this.onTouch, this);
    }

    protected onDestroy(): void {
        // Scene teardown 已进入节点预销毁阶段，子 Slot 的内部 Transform 可能已被清空。
        // 此处只能失效异步任务与释放引用，不能再 setPosition/setScale/active。
        this.unscheduleAllCallbacks();
        Tween.stopAllByTarget(this.node);
        if (this._lid) Tween.stopAllByTarget(this._lid);
        this._releaseToken++;
        this._releasing = false;
        this._onRelease = null;
        this._onActivated = null;
        this._canActivate = null;
        this._onDepleted = null;
        this.node.off(Node.EventType.TOUCH_END, this.onTouch, this);
    }
}
