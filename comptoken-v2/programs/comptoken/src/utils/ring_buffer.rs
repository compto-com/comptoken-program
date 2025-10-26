use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RingBuffer<T: Clone, const N: usize> {
    buffer: [T; N],
    position: u64,
}

impl<T: Clone + Default, const N: usize> Default for RingBuffer<T, N> {
    fn default() -> Self {
        Self::new_from_fn(|_| Default::default())
    }
}

pub struct RingBufferIterator<'a, T: Clone, const N: usize> {
    ring_buffer: &'a RingBuffer<T, N>,
    index: usize,
    count: usize,
}

impl<'a, T: Clone, const N: usize> RingBufferIterator<'a, T, N> {
    fn new(ring_buffer: &'a RingBuffer<T, N>) -> Self {
        Self { ring_buffer, index: ring_buffer.position as usize, count: 0 }
    }
}

impl<'a, T: Clone, const N: usize> Iterator for RingBufferIterator<'a, T, N> {
    type Item = T;

    fn next(&mut self) -> Option<Self::Item> {
        if N == 0 {
            return None;
        }
        let result = if self.count >= N { None } else { Some(self.ring_buffer.buffer[self.index].clone()) };

        self.count += 1;
        self.index = (self.index + 1) % N;
        result
    }

    fn nth(&mut self, n: usize) -> Option<Self::Item> {
        if N == 0 {
            return None;
        }
        self.count += n;
        self.index = (self.index + n) % N;
        self.next()
    }
}

impl<'a, T: Clone, const N: usize> IntoIterator for &'a RingBuffer<T, N> {
    type IntoIter = RingBufferIterator<'a, T, N>;
    type Item = T;

    fn into_iter(self) -> Self::IntoIter {
        RingBufferIterator::new(self)
    }
}

impl<T: Clone, const N: usize> RingBuffer<T, N> {
    pub fn new_with_value(default_value: T) -> Self {
        Self::new_from_fn(|_| default_value.clone())
    }

    pub fn new_from_fn<F: Fn(usize) -> T>(f: F) -> Self {
        Self { buffer: std::array::from_fn(f), position: 0 }
    }

    pub fn push(&mut self, value: T) {
        self.buffer[self.position as usize] = value;
        self.position = (self.position + 1) % N as u64;
    }

    pub fn get(&self, index: usize) -> Option<&T> {
        if index < N {
            Some(&self.buffer[index])
        } else {
            None
        }
    }

    pub fn current_position(&self) -> usize {
        self.position as usize
    }

    pub fn len(&self) -> usize {
        N
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_ring_buffer() {
        let rb: RingBuffer<_, 5> = RingBuffer::default();
        assert_eq!(rb.current_position(), 0);
        assert_eq!(rb.len(), 5);

        // All elements should be initialized to default value
        for i in 0..5 {
            assert_eq!(rb.get(i), Some(&0));
        }
    }

    #[test]
    fn test_new_with_value_ring_buffer() {
        let rb: RingBuffer<_, 5> = RingBuffer::new_with_value(1);
        assert_eq!(rb.current_position(), 0);
        assert_eq!(rb.len(), 5);

        // All elements should be initialized to default value
        for i in 0..5 {
            assert_eq!(rb.get(i), Some(&1));
        }
    }

    #[test]
    fn test_push_single_element() {
        let mut rb: RingBuffer<_, 3> = RingBuffer::default();

        rb.push(42);
        assert_eq!(rb.current_position(), 1);
        assert_eq!(rb.get(0), Some(&42));
        assert_eq!(rb.get(1), Some(&0));
        assert_eq!(rb.get(2), Some(&0));
    }

    #[test]
    fn test_push_multiple_elements() {
        let mut rb: RingBuffer<_, 3> = RingBuffer::default();

        rb.push(1);
        rb.push(2);
        rb.push(3);

        assert_eq!(rb.current_position(), 0); // Wrapped around
        assert_eq!(rb.get(0), Some(&1));
        assert_eq!(rb.get(1), Some(&2));
        assert_eq!(rb.get(2), Some(&3));
    }

    #[test]
    fn test_push_with_wraparound() {
        let mut rb: RingBuffer<_, 3> = RingBuffer::default();

        // Fill the buffer
        rb.push(1);
        rb.push(2);
        rb.push(3);

        // Add one more element, should wrap around
        rb.push(4);

        assert_eq!(rb.current_position(), 1);
        assert_eq!(rb.get(0), Some(&4)); // Overwrote the first element
        assert_eq!(rb.get(1), Some(&2));
        assert_eq!(rb.get(2), Some(&3));
    }

    #[test]
    fn test_get_out_of_bounds() {
        let rb: RingBuffer<i32, 3> = RingBuffer::default();
        assert_eq!(rb.get(3), None);
        assert_eq!(rb.get(100), None);
    }

    #[test]
    fn test_iterator_empty_buffer() {
        let rb: RingBuffer<i32, 3> = RingBuffer::default();
        let values: Vec<_> = rb.into_iter().collect();
        assert_eq!(values, vec![0, 0, 0]);
    }

    #[test]
    fn test_iterator_partially_filled() {
        let mut rb: RingBuffer<_, 5> = RingBuffer::default();
        rb.push(1);
        rb.push(2);

        let values: Vec<_> = rb.into_iter().collect();
        // Iterator starts from current position and goes around
        assert_eq!(values, vec![0, 0, 0, 1, 2]);
    }

    #[test]
    fn test_iterator_full_buffer() {
        let mut rb: RingBuffer<_, 3> = RingBuffer::new_with_value(-1);
        rb.push(1);
        rb.push(2);
        rb.push(3);

        let values: Vec<_> = rb.into_iter().collect();
        // Iterator starts from position 0 (after wraparound)
        assert_eq!(values, vec![1, 2, 3]);
    }

    #[test]
    fn test_iterator_with_wraparound() {
        let mut rb: RingBuffer<_, 3> = RingBuffer::default();
        rb.push(1);
        rb.push(2);
        rb.push(3);
        rb.push(4); // Overwrites position 0
        rb.push(5); // Overwrites position 1

        let values: Vec<_> = rb.into_iter().collect();
        // Iterator starts from current position (2) and wraps around
        assert_eq!(values, vec![3, 4, 5]);
    }

    #[test]
    fn test_iterator_nth() {
        let mut rb: RingBuffer<_, 5> = RingBuffer::default();
        rb.push(1);
        rb.push(2);
        rb.push(3);
        rb.push(4);
        rb.push(5);

        let mut iter = rb.into_iter();
        assert_eq!(iter.nth(2), Some(3)); // Skip 2 elements, get the 3rd
        assert_eq!(iter.next(), Some(4)); // Continue from where we left off
    }

    #[test]
    fn test_with_string_type() {
        let mut rb: RingBuffer<_, 2> = RingBuffer::new_with_value("default".to_string());

        rb.push("hello".to_string());
        rb.push("world".to_string());

        assert_eq!(rb.get(0), Some(&"hello".to_string()));
        assert_eq!(rb.get(1), Some(&"world".to_string()));

        let values: Vec<_> = rb.into_iter().collect();
        assert_eq!(values, vec!["hello".to_string(), "world".to_string()]);
    }

    #[test]
    fn test_with_custom_struct() {
        #[derive(Clone, PartialEq, Debug)]
        struct TestData {
            id: u32,
            value: String,
        }

        impl Default for TestData {
            fn default() -> Self {
                Self { id: 0, value: "default".to_string() }
            }
        }

        let mut rb: RingBuffer<TestData, 2> = RingBuffer::default();

        let data1 = TestData { id: 1, value: "first".to_string() };
        let data2 = TestData { id: 2, value: "second".to_string() };

        rb.push(data1.clone());
        rb.push(data2.clone());

        assert_eq!(rb.get(0), Some(&data1));
        assert_eq!(rb.get(1), Some(&data2));
    }

    #[test]
    fn test_zero_size_buffer() {
        let rb: RingBuffer<i32, 0> = RingBuffer::default();
        assert_eq!(rb.len(), 0);
        assert_eq!(rb.current_position(), 0);

        let values: Vec<_> = rb.into_iter().collect();
        assert_eq!(values, Vec::<i32>::new());
    }

    #[test]
    fn test_single_element_buffer() {
        let mut rb: RingBuffer<_, 1> = RingBuffer::default();

        rb.push(42);
        assert_eq!(rb.current_position(), 0); // Wrapped immediately
        assert_eq!(rb.get(0), Some(&42));

        rb.push(99);
        assert_eq!(rb.get(0), Some(&99)); // Overwrote the previous value

        let values: Vec<_> = rb.into_iter().collect();
        assert_eq!(values, vec![99]);
    }

    #[test]
    fn test_large_buffer() {
        let mut rb: RingBuffer<_, 1000> = RingBuffer::default();

        // Fill with indices
        for i in 0..1000 {
            rb.push(i);
        }

        assert_eq!(rb.current_position(), 0); // Should wrap back to start

        // Verify all elements
        for i in 0..1000 {
            assert_eq!(rb.get(i), Some(&i));
        }

        // Test iterator
        let values: Vec<_> = rb.into_iter().collect();
        let expected: Vec<_> = (0..1000).collect();
        assert_eq!(values, expected);
    }

    #[test]
    fn test_multiple_wraps() {
        let mut rb: RingBuffer<_, 3> = RingBuffer::default();

        // Push more elements than buffer size multiple times
        for i in 0..10 {
            rb.push(i);
        }

        // Should contain the last 3 elements
        assert_eq!(rb.current_position(), 1); // 10 % 3 = 1
        assert_eq!(rb.get(0), Some(&9)); // Last element pushed
        assert_eq!(rb.get(1), Some(&7)); // 10 - 3 = 7
        assert_eq!(rb.get(2), Some(&8)); // 10 - 2 = 8
    }
}
