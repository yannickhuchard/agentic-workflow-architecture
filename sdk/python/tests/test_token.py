"""
Tests for AWA Runtime Token
"""

import pytest
from awa.runtime.token import Token, TokenStatus


class TestToken:
    """Token class tests"""
    
    def test_token_creation(self):
        """Test basic token creation"""
        token = Token("activity-1", {"key": "value"})
        
        assert token.id is not None
        assert token.activity_id == "activity-1"
        assert token.status == TokenStatus.ACTIVE
        assert token.context_data == {"key": "value"}
        assert len(token.history) == 1
        assert token.history[0]["action"] == "created"
    
    def test_token_move(self):
        """Test token movement between activities"""
        token = Token("activity-1")
        token.move("activity-2")
        
        assert token.activity_id == "activity-2"
        assert token.status == TokenStatus.ACTIVE
        assert len(token.history) == 3  # created, exited, entered
    
    def test_token_status_update(self):
        """Test status updates"""
        token = Token("activity-1")
        token.update_status(TokenStatus.COMPLETED)
        
        assert token.status == TokenStatus.COMPLETED
        assert any("completed" in h["action"] for h in token.history)
    
    def test_token_data_operations(self):
        """Test context data operations"""
        token = Token("activity-1")
        
        token.set_data("foo", "bar")
        assert token.get_data("foo") == "bar"
        
        token.merge_data({"baz": 123, "qux": True})
        assert token.context_data == {"foo": "bar", "baz": 123, "qux": True}
    
    def test_token_to_dict(self):
        """Test dictionary conversion"""
        token = Token("activity-1", {"data": "test"})
        result = token.to_dict()
        
        assert "id" in result
        assert result["activity_id"] == "activity-1"
        assert result["status"] == "active"
        assert result["context_data"] == {"data": "test"}
