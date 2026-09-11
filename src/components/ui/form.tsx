"use client";

import type { Label as LabelPrimitive } from "radix-ui";
import { Slot } from "radix-ui";
import * as React from "react";
import {
  Controller,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
  FormProvider,
  useFormContext,
  useFormState,
} from "react-hook-form";
import { ProvenanceBadge } from "@/components/prefill/provenance-badge";
import { SuggestionChip } from "@/components/prefill/suggestion-chip";
import { useProvenance } from "@/components/prefill/provenance-context";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const Form = FormProvider;

type FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> = {
  name: TName;
};

const FormFieldContext = React.createContext<FormFieldContextValue>({} as FormFieldContextValue);

const FormField = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  ...props
}: ControllerProps<TFieldValues, TName>) => {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  );
};

const useFormField = () => {
  const fieldContext = React.useContext(FormFieldContext);
  const itemContext = React.useContext(FormItemContext);
  const { getFieldState } = useFormContext();
  const formState = useFormState({ name: fieldContext.name });
  const fieldState = getFieldState(fieldContext.name, formState);

  if (!fieldContext) {
    throw new Error("useFormField should be used within <FormField>");
  }

  const { id } = itemContext;

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  };
};

type FormItemContextValue = {
  id: string;
};

const FormItemContext = React.createContext<FormItemContextValue>({} as FormItemContextValue);

function FormItem({ className, children, ...props }: React.ComponentProps<"div">) {
  const id = React.useId();
  // FormItem is normally rendered inside a FormField; outside one the context is empty
  const fieldContext = React.useContext(FormFieldContext);
  const fieldName = fieldContext?.name;
  const { entry } = useProvenance(fieldName);

  return (
    <FormItemContext.Provider value={{ id }}>
      <div
        data-slot="form-item"
        data-field-path={fieldName}
        className={cn("grid gap-2", className)}
        {...props}
      >
        {children}
        {fieldName && entry?.state === "suggested" ? <SuggestionChip fieldPath={fieldName} /> : null}
      </div>
    </FormItemContext.Provider>
  );
}

function FormLabel({
  className,
  children,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  const { error, formItemId, name } = useFormField();

  // The badge is a <button>: rendered as a sibling of the <label>, not inside it, so
  // the control's accessible name is only the label text (and the markup stays valid).
  return (
    <span className="inline-flex items-center gap-2">
      <Label
        data-slot="form-label"
        data-error={!!error}
        className={cn("data-[error=true]:text-destructive", className)}
        htmlFor={formItemId}
        {...props}
      >
        {children}
      </Label>
      <ProvenanceBadge fieldPath={name} />
    </span>
  );
}

function FormControl({ ...props }: React.ComponentProps<typeof Slot.Root>) {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField();

  return (
    <Slot.Root
      data-slot="form-control"
      id={formItemId}
      aria-describedby={!error ? `${formDescriptionId}` : `${formDescriptionId} ${formMessageId}`}
      aria-invalid={!!error}
      {...props}
    />
  );
}

function FormDescription({ className, ...props }: React.ComponentProps<"p">) {
  const { formDescriptionId } = useFormField();

  return (
    <p
      data-slot="form-description"
      id={formDescriptionId}
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

function FormMessage({ className, ...props }: React.ComponentProps<"p">) {
  const { error, formMessageId } = useFormField();
  const body = error ? String(error?.message ?? "") : props.children;

  if (!body) {
    return null;
  }

  return (
    <p
      data-slot="form-message"
      id={formMessageId}
      className={cn("text-destructive text-sm", className)}
      {...props}
    >
      {body}
    </p>
  );
}

export {
  useFormField,
  Form,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  FormField,
};
