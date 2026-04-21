declare module "d3-force-3d" {
  export interface SimulationNodeDatum {
    index?: number;
    x?: number;
    y?: number;
    z?: number;
    vx?: number;
    vy?: number;
    vz?: number;
    fx?: number | null;
    fy?: number | null;
    fz?: number | null;
  }

  export interface SimulationLinkDatum<NodeDatum = SimulationNodeDatum> {
    source: NodeDatum | string | number;
    target: NodeDatum | string | number;
    index?: number;
  }

  export interface Simulation<
    NodeDatum extends SimulationNodeDatum = SimulationNodeDatum,
    LinkDatum extends SimulationLinkDatum<NodeDatum> =
      SimulationLinkDatum<NodeDatum>,
  > {
    restart(): this;
    stop(): this;
    tick(count?: number): this;
    nodes(): NodeDatum[];
    nodes(nodes: NodeDatum[]): this;
    alpha(): number;
    alpha(alpha: number): this;
    alphaMin(): number;
    alphaMin(min: number): this;
    alphaDecay(): number;
    alphaDecay(decay: number): this;
    alphaTarget(): number;
    alphaTarget(target: number): this;
    velocityDecay(): number;
    velocityDecay(decay: number): this;
    force(name: string): Force<NodeDatum> | undefined;
    force(name: string, force: Force<NodeDatum> | null): this;
    find(
      x: number,
      y: number,
      z?: number,
      radius?: number,
    ): NodeDatum | undefined;
    on(typenames: string): (event: Event) => void;
    on(typenames: string, listener: null): this;
    on(typenames: string, listener: (event: Event) => void): this;
  }

  export interface Force<
    NodeDatum extends SimulationNodeDatum = SimulationNodeDatum,
  > {
    (alpha: number): void;
    initialize?(nodes: NodeDatum[]): void;
  }

  export function forceSimulation<NodeDatum extends SimulationNodeDatum>(
    nodes?: NodeDatum[],
    nDimensions?: number,
  ): Simulation<NodeDatum>;

  export function forceLink<
    NodeDatum extends SimulationNodeDatum,
    LinkDatum extends SimulationLinkDatum<NodeDatum>,
  >(links?: LinkDatum[]): LinkForce<NodeDatum, LinkDatum>;

  export interface LinkForce<NodeDatum, LinkDatum> {
    (alpha: number): void;
    initialize(nodes: NodeDatum[]): void;
    links(): LinkDatum[];
    links(links: LinkDatum[]): this;
    id(): (
      node: NodeDatum,
      index?: number,
      nodes?: NodeDatum[],
    ) => string | number;
    id(
      id: (
        node: NodeDatum,
        index?: number,
        nodes?: NodeDatum[],
      ) => string | number,
    ): this;
    distance():
      | number
      | ((link: LinkDatum, index: number, links: LinkDatum[]) => number);
    distance(
      distance:
        | number
        | ((link: LinkDatum, index: number, links: LinkDatum[]) => number),
    ): this;
    strength():
      | number
      | ((link: LinkDatum, index: number, links: LinkDatum[]) => number);
    strength(
      strength:
        | number
        | ((link: LinkDatum, index: number, links: LinkDatum[]) => number),
    ): this;
  }

  export function forceManyBody<
    NodeDatum extends SimulationNodeDatum = SimulationNodeDatum,
  >(): ManyBodyForce<NodeDatum>;

  export interface ManyBodyForce<NodeDatum> {
    (alpha: number): void;
    initialize(nodes: NodeDatum[]): void;
    strength():
      | number
      | ((node: NodeDatum, index: number, nodes: NodeDatum[]) => number);
    strength(
      strength:
        | number
        | ((node: NodeDatum, index: number, nodes: NodeDatum[]) => number),
    ): this;
    theta(): number;
    theta(theta: number): this;
    distanceMin(): number;
    distanceMin(distance: number): this;
    distanceMax(): number;
    distanceMax(distance: number): this;
  }

  export function forceCenter<
    NodeDatum extends SimulationNodeDatum = SimulationNodeDatum,
  >(x?: number, y?: number, z?: number): CenterForce<NodeDatum>;

  export interface CenterForce<NodeDatum> {
    (alpha: number): void;
    initialize(nodes: NodeDatum[]): void;
    x(): number;
    x(x: number): this;
    y(): number;
    y(y: number): this;
    z(): number;
    z(z: number): this;
    strength(): number;
    strength(strength: number): this;
  }
}
