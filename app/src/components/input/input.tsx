import { FaChevronDown } from 'react-icons/fa'
import styles from './input.module.scss'

interface TextInputProps {
    type: 'text',
    onChange: (value: string) => void,
    value?: string,
    placeholder?: string,
    disabled?: boolean
}

interface TimeInputProps {
    type: 'time',
    onChange: (value: string) => void,
    value?: string,
    placeholder?: string,
    disabled?: boolean
}

interface SelectInputProps<T> {
    type: 'select',
    options: { value: T, label: string }[],
    value: T,
    onChange: (value: T) => void,
    allowDeselect?: boolean,
}

interface DropdownInputProps<T> {
    type: 'dropdown',
    options: { value: T, label: string }[],
    value: T,
    onChange: (value: T) => void,
    placeholder?: string,
}

interface MultiSelectInputProps<T> {
    type: 'multi-select',
    options: { value: T, label: string }[],
    value: T[],
    onChange: (value: T[]) => void,
}

interface SwitchInputProps {
    type: 'switch',
    value: boolean,
    onChange: (value: boolean) => void,
}

interface CustomInputProps {
    type: 'custom',
    children?: React.ReactNode
}

interface BaseInputProps {
    label?: string,
    ariaLabel?: string,
    disabled?: boolean,
    extraInfo?: React.ReactNode,
    skipSection?: true,
}

type InputProps<T> = (TextInputProps | TimeInputProps | SelectInputProps<T> | DropdownInputProps<T> | MultiSelectInputProps<T> | SwitchInputProps | CustomInputProps) & BaseInputProps

export default function Input<T>(props: InputProps<T>) {

    const inputContent = (
        <>
            {props.type === 'text' && (
                <input
                    className={styles.text}
                    type="text"
                    aria-label={props.ariaLabel ?? props.label}
                    disabled={props.disabled}
                    value={props.value}
                    placeholder={props.placeholder}
                    onChange={(e) => props.onChange(e.target.value)}
                />
            )}

            {props.type === 'time' && (
                <input
                    className={styles.text}
                    type="time"
                    aria-label={props.ariaLabel ?? props.label}
                    disabled={props.disabled}
                    value={props.value}
                    placeholder={props.placeholder}
                    onChange={(e) => props.onChange(e.target.value)}
                />
            )}

            {props.type === 'select' && (
                <div className={styles.selectButtons}>
                    {props.options.map((option, i) => (
                        <button
                            key={i}
                            type="button"
                            aria-pressed={props.value === option.value}
                            disabled={props.disabled}
                            className={`${styles.selectButton} ${props.value === option.value ? styles.activeSelectButton : ''}`}
                            onClick={(e) => {
                                e.preventDefault();
                                if (props.allowDeselect && props.value === option.value) {
                                    // Deselectable callers include undefined in T.
                                    props.onChange(undefined as T)
                                } else {
                                    props.onChange(option.value)
                                }
                            }}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            )}

            {props.type === 'dropdown' && (
                <div className={styles.dropdownWrapper}>
                    <select
                        className={styles.dropdown}
                        // Native <select> only carries string values, so we index into
                        // options rather than trying to serialize T directly — this keeps
                        // it working for object values too, not just strings/numbers.
                        value={props.options.findIndex(o => o.value === props.value)}
                        onChange={(e) => {
                            const index = Number(e.target.value)
                            props.onChange(props.options[index].value)
                        }}
                    >
                        {props.placeholder && (
                            <option value={-1} disabled>{props.placeholder}</option>
                        )}
                        {props.options.map((option, i) => (
                            <option key={i} value={i}>{option.label}</option>
                        ))}
                    </select>
                    <FaChevronDown className={styles.dropdownIcon} size={14} />
                </div>
            )}

            {props.type === 'multi-select' && (
                <div className={styles.selectButtons}>
                    {props.options.map((option, i) => (
                        <button
                            key={i}
                            type="button"
                            aria-pressed={props.value.includes(option.value)}
                            disabled={props.disabled}
                            className={`${styles.selectButton} ${props.value.includes(option.value) ? styles.activeSelectButton : ''}`}
                            onClick={(e) => {
                                e.preventDefault();
                                props.onChange(
                                    props.value.includes(option.value) ?
                                        props.value.filter(value => value !== option.value) :
                                        [...props.value, option.value]
                                )
                            }}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            )}

            {props.type === 'switch' && (
                <label className={styles.switch}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}>
                    <input
                        type="checkbox"
                        aria-label={props.ariaLabel ?? props.label}
                        disabled={props.disabled}
                        checked={props.value}
                        onChange={(e) => props.onChange(e.target.checked)}
                    />
                    <span className={styles.slider}></span>
                </label>
            )}

            {props.type === 'custom' && (props.children)}

            {props.extraInfo && (
                <div className={styles.extraInfo}>
                    {props.extraInfo}
                </div>
            )}
        </>
    )

    if (props.skipSection) {
        return inputContent
    }

    return (
        <div className={styles.section}>
            <div className={styles.label}>
                {props.label}
            </div>
            {inputContent}
        </div>
    )
}
