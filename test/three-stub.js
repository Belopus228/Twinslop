// Заглушка three для headless-теста: всё настоящее, кроме WebGLRenderer.
import * as T from '../node_modules/three/build/three.module.js';
export const Scene = T.Scene;
export const Color = T.Color;
export const Fog = T.Fog;
export const PerspectiveCamera = T.PerspectiveCamera;
export const HemisphereLight = T.HemisphereLight;
export const DirectionalLight = T.DirectionalLight;
export const PointLight = T.PointLight;
export const MeshStandardMaterial = T.MeshStandardMaterial;
export const LineBasicMaterial = T.LineBasicMaterial;
export const PointsMaterial = T.PointsMaterial;
export const Mesh = T.Mesh;
export const Group = T.Group;
export const Points = T.Points;
export const LineSegments = T.LineSegments;
export const BoxGeometry = T.BoxGeometry;
export const SphereGeometry = T.SphereGeometry;
export const CylinderGeometry = T.CylinderGeometry;
export const OctahedronGeometry = T.OctahedronGeometry;
export const EdgesGeometry = T.EdgesGeometry;
export const BufferGeometry = T.BufferGeometry;
export const BufferAttribute = T.BufferAttribute;
export const Vector3 = T.Vector3;
export const Box3 = T.Box3;
export const MathUtils = T.MathUtils;
export class WebGLRenderer {
  constructor() { this.shadowMap = {}; this.domElement = null; }
  setPixelRatio() {}
  setSize() {}
  render() {}
  dispose() {}
}
