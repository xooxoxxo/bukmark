import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import styles from './Checkbox.module.css';

export type CheckboxProps = Omit<
  ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>,
  'onCheckedChange'
> & {
  onCheckedChange?: (checked: boolean) => void;
};

export const Checkbox = forwardRef<
  ElementRef<typeof CheckboxPrimitive.Root>,
  CheckboxProps
>(function Checkbox({ className, onCheckedChange, ...props }, ref) {
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      className={[styles.root, className].filter(Boolean).join(' ')}
      onCheckedChange={(checked) => onCheckedChange?.(checked === true)}
      {...props}
    >
      <CheckboxPrimitive.Indicator className={styles.indicator}>
        <svg viewBox="0 0 12 10" aria-hidden="true">
          <path d="M1 5 4.3 8.3 11 1.4" />
        </svg>
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});
