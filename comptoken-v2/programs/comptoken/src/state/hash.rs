use anchor_lang::prelude::*;

// wrapper around solana_hash::Hash to implement AnchorSerialize, AnchorDeserialize, IdlBuild, bytemuck::Pod, and bytemuck::Zeroable
#[repr(transparent)]
#[derive(Clone, Copy, Default, PartialEq, Eq, Debug)]
pub struct Hash(solana_hash::Hash);

impl std::ops::Deref for Hash {
    type Target = solana_hash::Hash;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl AnchorDeserialize for Hash {
    fn deserialize_reader<R: std::io::Read>(reader: &mut R) -> std::io::Result<Self> {
        Ok(Hash(solana_hash::Hash::new_from_array(AnchorDeserialize::deserialize_reader(reader)?)))
    }
}

impl AnchorSerialize for Hash {
    fn serialize<W: std::io::Write>(&self, writer: &mut W) -> std::io::Result<()> {
        AnchorSerialize::serialize(self.0.as_bytes(), writer)
    }
}

#[cfg(feature = "idl-build")]
use anchor_lang::idl::types::{
    IdlArrayLen, IdlDefinedFields, IdlRepr, IdlSerialization, IdlType, IdlTypeDef, IdlTypeDefTy,
};

#[cfg(feature = "idl-build")]
impl anchor_lang::IdlBuild for Hash {
    fn create_type() -> Option<IdlTypeDef> {
        use std::vec;

        Some(IdlTypeDef {
            name: "Hash".to_string(),
            ty: IdlTypeDefTy::Struct {
                fields: Some(IdlDefinedFields::Tuple(vec![IdlType::Array(
                    Box::new(IdlType::U8),
                    IdlArrayLen::Value(32),
                )])),
            },
            generics: vec![],
            docs: vec![],
            serialization: IdlSerialization::Borsh,
            repr: Some(IdlRepr::Transparent),
        })
    }
}

unsafe impl bytemuck::Pod for Hash {}
unsafe impl bytemuck::Zeroable for Hash {}
