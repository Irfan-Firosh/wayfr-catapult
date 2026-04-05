/**
 * Shared types for the persona detection + annotation system.
 */

// ── Persona Profile ──────────────────────────────────────────────────────────

export interface DerivedAnnotation {
  /** New label to create (e.g. "Emergency Exit") */
  label: string
  /** Original object label this maps onto (e.g. "door") */
  mappedFrom: string
  /** Why this matters to the persona */
  description: string
  priority: AnnotationPriority
}

export interface PersonaColorScheme {
  /** Primary highlight color (hex) */
  primary: string
  /** Secondary / supporting objects color (hex) */
  secondary: string
  /** Critical / danger objects color (hex) */
  danger: string
}

export interface PersonaProfile {
  role: string
  summary: string
  primaryNeeds: string[]
  /** Object labels from the scene to prioritize */
  annotationFocus: string[]
  derivedAnnotations: DerivedAnnotation[]
  colorScheme: PersonaColorScheme
  /** Narrative tone, e.g. "safety-focused", "accessibility-first" */
  narrativeStyle: string
}

// ── Annotation Plan ──────────────────────────────────────────────────────────

export type AnnotationPriority = "critical" | "high" | "medium" | "low"

export interface PersonaAnnotation {
  /** Matches ObjectItem.id from the scene */
  objectId: string
  originalLabel: string
  /** Relabeled for this persona context */
  personaLabel: string
  /** One sentence: why this matters for this persona */
  personaDescription: string
  priority: AnnotationPriority
  /** Hex color for this annotation */
  color: string
  /** True if this is a new derived annotation mapped onto an existing object */
  isNew: boolean
}

export interface AnnotationPlan {
  personaRole: string
  summary: string
  annotations: PersonaAnnotation[]
}

// ── Chat message types ───────────────────────────────────────────────────────

export type MessageRole = "user" | "assistant"

export interface BaseMessage {
  id: string
  role: MessageRole
}

export interface TextMessage extends BaseMessage {
  type: "text"
  text: string
  streaming?: boolean
}

export interface PersonaBadgeMessage extends BaseMessage {
  type: "persona_badge"
  persona: PersonaProfile
}

export interface HomePickerMessage extends BaseMessage {
  type: "home_picker"
}

export interface PersonaEditorMessage extends BaseMessage {
  type: "persona_editor"
  persona: PersonaProfile
}

export interface SceneMessage extends BaseMessage {
  type: "scene"
  homeId: string
  homeName: string
  plan: AnnotationPlan
}

export type ChatMessage =
  | TextMessage
  | PersonaBadgeMessage
  | HomePickerMessage
  | PersonaEditorMessage
  | SceneMessage
