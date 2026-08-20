import {
    Color, Graphics, Label, Node, UITransform, Vec3,
} from 'cc';

/**
 * 极简 UI 控件工具（原型阶段无美术资源时使用）。
 *
 * 说明：这些控件用 `Graphics` + 系统字体 `Label` 生成，
 * 目的是让 Loading / Hall / Result 流程在**没有任何美术素材**时也能跑通。
 * 以后接入正式 UI Prefab 后，这里可以整体不用，但不必删除（fallback 仍有价值）。
 */

export function makeNode(name: string, parent: Node, pos: Vec3, w: number, h: number): Node {
    const node = new Node(name);
    const ui = node.addComponent(UITransform);
    ui.setContentSize(w, h);
    node.setParent(parent);
    node.setPosition(pos);
    return node;
}

/** 纯色矩形背景 */
export function makeRect(
    parent: Node, pos: Vec3, w: number, h: number,
    color: Color, radius: number = 8, name: string = 'Rect'
): Node {
    const node = makeNode(name, parent, pos, w, h);
    const g = node.addComponent(Graphics);
    g.fillColor = color;
    g.roundRect(-w / 2, -h / 2, w, h, radius);
    g.fill();
    return node;
}

/** 文本 */
export function makeLabel(
    parent: Node, pos: Vec3, text: string,
    fontSize: number = 28, color: Color = new Color(240, 240, 245, 255),
    name: string = 'Label'
): Label {
    const node = makeNode(name, parent, pos, 600, fontSize * 1.6);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = fontSize;
    label.lineHeight = fontSize * 1.25;
    label.color = color;
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    return label;
}

/**
 * 按钮（背景 + 文字 + 点击回调）。
 * 不依赖 cc.Button，直接用节点触摸事件，避免额外资源需求。
 */
export function makeButton(
    parent: Node, pos: Vec3, text: string, onClick: () => void,
    w: number = 300, h: number = 88,
    bg: Color = new Color(70, 120, 200, 255),
    name: string = 'Button'
): Node {
    const node = makeNode(name, parent, pos, w, h);

    const g = node.addComponent(Graphics);
    g.fillColor = bg;
    g.roundRect(-w / 2, -h / 2, w, h, 12);
    g.fill();
    g.lineWidth = 3;
    g.strokeColor = new Color(255, 255, 255, 120);
    g.roundRect(-w / 2, -h / 2, w, h, 12);
    g.stroke();

    const label = makeLabel(node, new Vec3(0, 0, 0), text, 30);
    label.node.setSiblingIndex(1);

    node.on(Node.EventType.TOUCH_END, () => onClick());
    return node;
}

/** 简易进度条：返回一个 setProgress(0~1) 函数 */
export function makeProgressBar(
    parent: Node, pos: Vec3, w: number = 520, h: number = 26
): (p: number) => void {
    const node = makeNode('ProgressBar', parent, pos, w, h);

    const bg = node.addComponent(Graphics);
    bg.fillColor = new Color(50, 54, 66, 255);
    bg.roundRect(-w / 2, -h / 2, w, h, h / 2);
    bg.fill();

    const fillNode = makeNode('Fill', node, new Vec3(0, 0, 0), w, h);
    const fg = fillNode.addComponent(Graphics);

    return (p: number) => {
        const clamped = Math.max(0, Math.min(1, p));
        fg.clear();
        if (clamped <= 0) return;
        fg.fillColor = new Color(90, 190, 120, 255);
        const fw = (w - 6) * clamped;
        fg.roundRect(-w / 2 + 3, -h / 2 + 3, fw, h - 6, (h - 6) / 2);
        fg.fill();
    };
}

/** 半透明遮罩（用于 Pause / Result） */
export function makeMask(parent: Node, alpha: number = 170): Node {
    const node = makeNode('Mask', parent, new Vec3(0, 0, 0), 750, 1334);
    const g = node.addComponent(Graphics);
    g.fillColor = new Color(0, 0, 0, alpha);
    g.rect(-375, -667, 750, 1334);
    g.fill();
    return node;
}
