import type { MentorStarterPreset } from '../types';

export const MENTOR_STARTER_PRESETS: MentorStarterPreset[] = [
  {
    id: 'index_loop',
    title: 'Цикл for та межі списку',
    topic: 'Індексація списків',
    level: 'beginner',
    code: `scores = [10, 12, 9, 11, 8]
total = 0

for i in range(len(scores) + 1):
    total += scores[i]

print("Середній бал:", total / len(scores))`,
    errorLog: `IndexError: list index out of range (рядок 5)`,
    studentQuestion: 'Чому виникає IndexError, якщо я перебираю всі оцінки зі списку?',
  },
  {
    id: 'mutable_default',
    title: 'Список у функції та пошук парних',
    topic: 'Функції та списки',
    level: 'intermediate',
    code: `def add_even(num, result=[]):
    if num % 2 == 0:
        result.append(num)
    return result

print(add_even(4))
print(add_even(6))`,
    errorLog: `Очікував отримати [6] при другому виклику, але вивело [4, 6]. Чому?`,
    studentQuestion: 'Чому другий виклик функції пам’ятає число 4 з першого виклику?',
  },
  {
    id: 'recursion_base',
    title: 'Рекурсивний факторіал',
    topic: 'Рекурсія',
    level: 'advanced',
    code: `def factorial(n):
    if n == 1:
        return 1
    return n * factorial(n - 1)

print(factorial(5))
print(factorial(0))`,
    errorLog: `RecursionError: maximum recursion depth exceeded при виклику factorial(0)`,
    studentQuestion: 'Для 5 працює чудово, а на 0 програма падає. Де помилка в логіці?',
  },
];

export const PLAGIARISM_SAMPLE_HUMAN = `spysok = [3, 7, 2, 9, 4]
max_num = spysok[0]
for x in spysok:
    if x > max_num:
        max_num = x
print("Naibilshe:", max_num)`;

export const PLAGIARISM_SAMPLE_AI = `from typing import List, Optional

def find_maximum_element(numbers: List[int]) -> Optional[int]:
    """
    Finds and returns the maximum integer in the provided list.

    Args:
        numbers (List[int]): A list of integers to evaluate.

    Returns:
        Optional[int]: The maximum value, or None if the list is empty.
    """
    if not numbers:
        return None

    # Initialize the maximum value with the first element
    current_max = numbers[0]
    for value in numbers[1:]:
        if value > current_max:
            current_max = value

    return current_max

if __name__ == "__main__":
    sample_data = [3, 7, 2, 9, 4]
    print(f"The maximum value is: {find_maximum_element(sample_data)}")`;
